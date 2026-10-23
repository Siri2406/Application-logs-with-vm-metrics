import asyncio
import logging
import base64
from collections import deque
from typing import Dict, Any, Optional
import httpx
from config.settings import settings
import datetime

logger = logging.getLogger(__name__)

class AzureLogStreamService:
    def __init__(self):
        self.buffer = deque(maxlen=settings.LOG_BUFFER_SIZE)
        self.connected = False
        self.last_log_received_at: Optional[datetime.datetime] = None
        self._streaming_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self.listeners = []

        if settings.LOG_SOURCE == "mock":
            logger.info("Initializing in mock mode. Will not connect to Azure.")

    @staticmethod
    def is_ignorable_banner(line: str) -> bool:
        low = line.lower().strip()
        if not low:
            return True
        if "welcome, you are now connected" in low:
            return True
        if "connected to log-streaming service" in low:
            return True
        if "default timeout is 2 hours" in low:
            return True
        return False

    def add_listener(self, queue: asyncio.Queue):
        self.listeners.append(queue)

    def remove_listener(self, queue: asyncio.Queue):
        if queue in self.listeners:
            self.listeners.remove(queue)

    async def broadcast(self, message: str):
        for queue in self.listeners:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass

    def get_status(self) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "app_service": settings.AZURE_APP_SERVICE_NAME if settings.LOG_SOURCE == "azure" else "mock",
            "last_log_received_at": self.last_log_received_at.isoformat() if self.last_log_received_at else None,
            "buffer_size": len([l for l in self.buffer if not self.is_ignorable_banner(l)]),
            "mode": settings.LOG_SOURCE,
        }

    def fetch_recent_logs_from_azure(self, limit: int = 50) -> str:
        """
        Fetches the latest real live application and container logs directly
        from Azure App Service Kudu VFS storage (/api/vfs/LogFiles/).
        """
        if not settings.AZURE_APP_SERVICE_NAME or not settings.KUDU_USERNAME or not settings.KUDU_PASSWORD:
            return ""
        try:
            import json
            import urllib.request
            basic = base64.b64encode(f"{settings.KUDU_USERNAME}:{settings.KUDU_PASSWORD}".encode()).decode()
            headers = {"Authorization": f"Basic {basic}"}
            vfs_url = f"https://{settings.AZURE_APP_SERVICE_NAME}.scm.azurewebsites.net/api/vfs/LogFiles/"
            req = urllib.request.Request(vfs_url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                items = json.loads(resp.read().decode())

            log_files = [i for i in items if i.get("name", "").endswith(".log")]
            if not log_files:
                return ""
            log_files.sort(key=lambda x: str(x.get("mtime") or ""), reverse=True)
            latest = log_files[0]

            req2 = urllib.request.Request(latest["href"], headers=headers)
            with urllib.request.urlopen(req2, timeout=10) as resp2:
                content = resp2.read().decode("utf-8", errors="ignore")

            lines = [l.strip() for l in content.splitlines() if l.strip() and not self.is_ignorable_banner(l)]
            return "\n".join(lines[-limit:])
        except Exception as e:
            logger.warning(f"Error fetching live logs from Azure VFS LogFiles: {e}")
            return ""

    def get_buffered_logs(self) -> str:
        valid = [l for l in self.buffer if not self.is_ignorable_banner(l)]
        if valid:
            return "\n".join(valid)
        live = self.fetch_recent_logs_from_azure(50)
        if live:
            for l in live.splitlines():
                if l.strip() and not self.is_ignorable_banner(l):
                    self.buffer.append(l.strip())
        return live

    async def _preseed_logs(self):
        try:
            initial_logs = await asyncio.to_thread(self.fetch_recent_logs_from_azure, 50)
            if initial_logs:
                for line in initial_logs.splitlines():
                    if line.strip() and not self.is_ignorable_banner(line):
                        self.buffer.append(line.strip())
        except Exception as exc:
            logger.warning(f"Could not pre-seed Azure logs: {exc}")

    async def start(self):
        if settings.LOG_SOURCE == "mock":
            self.connected = True
            return

        # Pre-seed buffer asynchronously in background so server startup is instantaneous
        asyncio.create_task(self._preseed_logs())

        self._stop_event.clear()
        self._streaming_task = asyncio.create_task(self._run_stream())
        logger.info("Started Azure log stream background task.")

    async def stop(self):
        self._stop_event.set()
        if self._streaming_task:
            self._streaming_task.cancel()
            try:
                await self._streaming_task
            except asyncio.CancelledError:
                pass
        self.connected = False

    async def _run_stream(self):
        while not self._stop_event.is_set():
            try:
                await self._connect_and_stream()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.connected = False
                logger.error(f"Log stream error: {e}")
                retry_sec = max(settings.LOG_STREAM_RETRY_SECONDS, 10)
                logger.info(f"Reconnecting in {retry_sec}s...")
                await asyncio.sleep(retry_sec)

    async def _connect_and_stream(self):
        if not settings.AZURE_APP_SERVICE_NAME:
            raise Exception("AZURE_APP_SERVICE_NAME is not set in .env")
        if not settings.KUDU_USERNAME or not settings.KUDU_PASSWORD:
            raise Exception("KUDU_USERNAME and KUDU_PASSWORD must be set in .env")

        logger.info(f"Connecting to {settings.AZURE_APP_SERVICE_NAME}...")

        basic = base64.b64encode(
            f"{settings.KUDU_USERNAME}:{settings.KUDU_PASSWORD}".encode()
        ).decode()

        url = f"https://{settings.AZURE_APP_SERVICE_NAME}.scm.azurewebsites.net/api/logstream"
        headers = {
            "Authorization": f"Basic {basic}",
            "Accept": "text/event-stream",
        }

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", url, headers=headers) as resp:
                if resp.status_code in (401, 403):
                    raise Exception(f"Auth failed ({resp.status_code}). Check KUDU_USERNAME/KUDU_PASSWORD.")
                if resp.status_code != 200:
                    raise Exception(f"Kudu API returned {resp.status_code}")

                logger.info("Connected to log stream ✓")
                self.connected = True

                async for line in resp.aiter_lines():
                    if line:
                        await self._process_log_line(line)

    async def _process_log_line(self, line: str):
        # Ignore Kudu welcome greeting or connection status lines
        if self.is_ignorable_banner(line):
            return
        self.last_log_received_at = datetime.datetime.now(datetime.timezone.utc)
        self.buffer.append(line)
        await self.broadcast(line)

log_stream_service = AzureLogStreamService()


