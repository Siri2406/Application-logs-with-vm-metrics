import asyncio
import logging
import os
import re
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Setup logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("unified_backend")

# Ensure backend root is in sys.path
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Routers from Infrastructure Agent (CPU, Disk, Memory, Metrics, Remediation)
from routers.cpu_router import router as cpu_router
from routers.disk_router import router as disk_router
from routers.memory_router import router as memory_router
from routers.metrics_router import router as metrics_router
from routers.remediation_router import router as remediation_router

# Log Streaming Services and Routers (Azure & GCP Application Logs)
from services.log_stream_manager import log_stream_manager
from api.log_stream import router as log_stream_router
from tools.metrics_fetcher import fetch_current_metrics, fetch_metrics_history
from services.email_service import (
    get_highest_crossed_threshold,
    send_threshold_alert_email,
)

# Application Log Agent (Google ADK / Runner)
try:
    from google.adk.runners import Runner
    from google.adk.sessions.in_memory_session_service import InMemorySessionService
    from google.genai import types
    from agents.application_agent.agent import root_agent as app_agent

    app_runner = Runner(
        agent=app_agent,
        app_name="app_agent_app",
        session_service=InMemorySessionService(),
        auto_create_session=True,
    )
    ADK_AVAILABLE = True
except Exception as e:
    logger.warning(f"Google ADK / Application Agent Runner initialization warning: {e}")
    app_runner = None
    ADK_AVAILABLE = False


# Background periodic telemetry poller for CPU, RAM, Disk threshold alerting
async def periodic_metrics_poller(interval_seconds: int = 60):
    """Fetch VM telemetry and send one alert when a resource crosses above configured thresholds."""
    previously_above_70 = {"CPU": False, "RAM": False, "Disk": False}
    while True:
        try:
            loop = asyncio.get_running_loop()
            data = await loop.run_in_executor(None, fetch_metrics_history)
            current = await loop.run_in_executor(None, fetch_current_metrics)

            cpu = current.get("cpu") or {}
            ram = current.get("ram") or {}
            disk = current.get("disk") or {}

            latest = data[-1] if data else {}
            latest_cpu = latest.get("cpu") or {}
            latest_ram = latest.get("ram") or {}
            latest_disk = latest.get("disk") or {}

            metrics = {
                "CPU": max(float(cpu.get("total", 0) or 0), float(latest_cpu.get("total", 0) or 0)),
                "RAM": max(float(ram.get("percent", 0) or 0), float(latest_ram.get("percent", 0) or 0)),
                "Disk": max(float(disk.get("percent", 0) or 0), float(latest_disk.get("percent", 0) or 0)),
            }
            recipient = os.getenv("DEFAULT_ALERT_EMAIL", "").strip()
            for resource, usage in metrics.items():
                cores_list = cpu.get("per_core") if resource == "CPU" else None
                matched_th = get_highest_crossed_threshold(
                    usage, per_core=cores_list, resource_name=resource
                )
                if matched_th is not None and previously_above_70.get(resource) != matched_th and recipient:
                    await loop.run_in_executor(
                        None,
                        send_threshold_alert_email,
                        resource,
                        usage,
                        matched_th,
                        current.get("hostname", "system-host"),
                        current.get("timestamp", ""),
                        {
                            "current_usage": f"{usage:.1f}%",
                            "source": "background_vm_poller",
                            "highest_threshold_crossed": matched_th,
                        },
                        None,
                        recipient,
                    )
                    logger.info(f"Automatic {resource} alert (tier {matched_th}%) sent to {recipient}")
                    previously_above_70[resource] = matched_th
                elif matched_th is None:
                    previously_above_70[resource] = None
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"Background metrics poller encountered error: {exc}")
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Start application log stream background listeners (Azure & GCP)
    try:
        await log_stream_manager.start_all()
        logger.info("Log stream managers started.")
    except Exception as e:
        logger.warning(f"Error starting log stream manager: {e}")

    # 2. Launch background VM metrics poller
    poller_task = asyncio.create_task(periodic_metrics_poller(interval_seconds=60))
    logger.info("Periodic metrics poller started.")

    yield

    # Shutdown
    poller_task.cancel()
    try:
        await poller_task
    except asyncio.CancelledError:
        pass

    try:
        await log_stream_manager.stop_all()
        logger.info("Log stream managers stopped.")
    except Exception as e:
        logger.warning(f"Error stopping log stream manager: {e}")


app = FastAPI(
    title="Unified Multi-Agent Ecosystem",
    description=(
        "Autonomous multi-agent platform combining Infrastructure Utilization "
        "Monitoring (CPU, RAM, Disk, Metrics, Remediation) and Application Log Reliability (Azure, GCP, Mock Log Streams)."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# CORS configuration to allow local Vite frontend and all standard development origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    # Avoid log flooding for SSE stream endpoints
    if "/stream" not in request.url.path:
        logger.info(f"🚀 [HTTP {request.method}] {request.url.path}")
    response = await call_next(request)
    if "/stream" not in request.url.path:
        logger.info(f"✅ [HTTP {request.method}] {request.url.path} -> Status {response.status_code}")
    return response


# --- Infrastructure Routers ---
app.include_router(cpu_router)
app.include_router(disk_router)
app.include_router(memory_router)
app.include_router(metrics_router)
app.include_router(remediation_router)

# --- Application Log Routers ---
app.include_router(log_stream_router, prefix="/api/application/logs", tags=["Application Logs"])


@app.get("/health", tags=["Health"])
async def health_check():
    """Liveness endpoint for deployment and dashboard connection verification."""
    return {
        "status": "healthy",
        "service": "unified-reliability-agent-backend",
        "adk_available": ADK_AVAILABLE,
        "log_streaming": log_stream_manager.get_status(),
    }


# ==============================================================================
# Application Log Agent & Analysis Endpoints
# ==============================================================================

MOCKDATA_DIR = BACKEND_ROOT / "mockdata"

chat_history_store = {"sessions": []}


class SessionData(BaseModel):
    sessions: List[Dict[str, Any]]


@app.get("/api/application/sessions", tags=["Application Agent"])
async def get_sessions():
    return chat_history_store


@app.post("/api/application/sessions", tags=["Application Agent"])
async def save_sessions(data: SessionData):
    chat_history_store["sessions"] = data.sessions
    return {"status": "success"}


@app.get("/api/mockfiles", tags=["Application Agent"])
async def get_mock_files():
    try:
        if not MOCKDATA_DIR.exists():
            MOCKDATA_DIR.mkdir(parents=True, exist_ok=True)
        files = [f.name for f in MOCKDATA_DIR.iterdir() if f.is_file()]
        return {"files": sorted(files)}
    except Exception as e:
        return {"files": [], "error": str(e)}


def filter_log_content(
    raw_text: str, severity: Optional[str] = None, keyword: Optional[str] = None
) -> tuple[str, int]:
    if not raw_text:
        return "", 0
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]

    # 1. Keyword filter
    if keyword and keyword.strip():
        kw = keyword.strip().lower()
        lines = [l for l in lines if kw in l.lower()]

    # 2. Severity filter
    if severity and severity.upper() != "ALL":
        sev = severity.upper()
        sev_patterns = {
            "CRITICAL": re.compile(r"\b(500|out of memory|oom|fatal|panic|crash)\b", re.I),
            "ERROR": re.compile(r"\b(error|exception|failed|failure|401|403|400|502|503|refused|sig=|token)\b", re.I),
            "HIGH": re.compile(r"\b(error|exception|failed|failure|401|403|400|502|503|refused|sig=|token)\b", re.I),
            "WARNING": re.compile(r"\b(warn|warning|timeout|retry|deprecated)\b", re.I),
            "INFO": re.compile(r"\b(info|information|started|completed|success)\b", re.I),
        }
        pat = sev_patterns.get(sev)
        if pat:
            lines = [l for l in lines if pat.search(l)]

    return "\n".join(lines), len(lines)


def run_agent_sync(runner, text: str) -> str:
    if not runner:
        return (
            "Application Agent Runner is not initialized. Please ensure google-adk or litellm and model credentials "
            "are properly installed and configured in backend/.env."
        )

    session_id = str(uuid.uuid4())
    if text.startswith("analyze:"):
        payload = text.split(":", 1)[1]
        if payload == "live:gcp":
            prompt_text = (
                "Please analyze the GCP Compute Engine live application logs. "
                "Call the analyze_application_logs tool with log_content='analyze:live:gcp'."
            )
        elif payload in ("live", "live:azure"):
            prompt_text = (
                "Please analyze the Azure App Service live application logs. "
                "Call the analyze_application_logs tool with log_content='analyze:live:azure'."
            )
        else:
            filepath = str(MOCKDATA_DIR / payload)
            prompt_text = (
                f"Please analyze the log file at {filepath}. "
                f"Call the analyze_application_logs tool passing this exact file path as the log_content."
            )
    elif text.strip().lower() == "analyze":
        prompt_text = "Please analyze the logs."
    else:
        prompt_text = f"Please analyze these logs:\n{text}"

    msg = types.Content(role="user", parts=[types.Part.from_text(text=prompt_text)])

    events = runner.run(
        user_id="default_user",
        session_id=session_id,
        new_message=msg,
    )

    response_text = ""
    for event in events:
        if getattr(event, "message", None):
            if hasattr(event.message, "parts"):
                for part in event.message.parts:
                    if hasattr(part, "text") and part.text:
                        response_text += part.text
        elif getattr(event, "output", None):
            if hasattr(event.output, "text"):
                response_text += event.output.text
            elif hasattr(event.output, "content"):
                response_text += event.output.content
            else:
                response_text += str(event.output)

    return response_text


@app.post("/api/application/analyze", tags=["Application Agent"])
async def analyze_application(
    text: str = Form(...),
    severity_filter: Optional[str] = Form(None),
    keyword_filter: Optional[str] = Form(None),
    cloud_provider: Optional[str] = Form(None),
):
    try:
        from tools.application_log_tools import get_recent_application_logs

        is_mock = text.startswith("analyze:") and not text.startswith("analyze:live")
        is_gcp_live = text == "analyze:live:gcp" or (
            cloud_provider and cloud_provider.lower() == "gcp" and not is_mock
        )

        if is_mock:
            filename = text.split(":", 1)[1]
            filepath = MOCKDATA_DIR / filename
            source_name = filename
            if filepath.exists():
                with open(filepath, "r", encoding="utf-8") as f:
                    raw_logs = f.read()
            else:
                raw_logs = f"Mock file {filename} not found at {filepath}"
        elif is_gcp_live:
            source_name = "GCP Live Logs"
            raw_logs = get_recent_application_logs(source="gcp")
        else:
            source_name = "Azure Live Logs"
            raw_logs = get_recent_application_logs(source="azure")

        # Build filter label
        filter_parts = []
        if severity_filter and severity_filter.upper() != "ALL":
            filter_parts.append(f"Severity={severity_filter.upper()}")
        if keyword_filter and keyword_filter.strip():
            filter_parts.append(f"Keyword='{keyword_filter.strip()}'")

        has_filter = bool(filter_parts)
        filter_label = f" [{', '.join(filter_parts)}]" if has_filter else ""
        file_name = f"{source_name}{filter_label}"

        # Apply filtering
        if has_filter:
            filtered_logs, match_count = filter_log_content(
                raw_logs, severity=severity_filter, keyword=keyword_filter
            )
            if match_count == 0:
                return {
                    "response": (
                        f"No log lines matched the active filter ({', '.join(filter_parts)}). "
                        "Please try broader search keywords or change the severity level."
                    ),
                    "file_name": file_name,
                    "analyzed_logs": "No matching log lines found.",
                }
            analyzed_logs = filtered_logs
            agent_input = f"Please analyze these filtered logs ({', '.join(filter_parts)}):\n{filtered_logs}"
        else:
            analyzed_logs = raw_logs
            agent_input = text

        response = await asyncio.to_thread(run_agent_sync, app_runner, agent_input)
        return {
            "response": response,
            "file_name": file_name,
            "analyzed_logs": analyzed_logs,
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        return {"response": f"Error occurred: {str(e)}"}


@app.get("/api/application/metrics/azure", tags=["Azure Monitor Metrics"])
async def get_azure_application_metrics(force_refresh: bool = False):
    """
    Fetches real-time Azure Monitor & App Service diagnostic telemetry:
    - CPU (machine % used, CPU time seconds timeseries)
    - Memory (machine % used, working set MB timeseries)
    - Disk (mount usages for / and /mnt, IO ops/sec)
    - Network (bytes in/out, requests count, response time)
    - Process summary (total processes running on worker instance)
    """
    try:
        from services.azure_metrics_service import azure_metrics_service
        data = await azure_metrics_service.get_all_application_metrics(force_refresh=force_refresh)
        return data
    except Exception as exc:
        logger.exception(f"Error fetching Azure metrics: {exc}")
        return {"status": "error", "error": str(exc)}


@app.get("/api/application/metrics/azure/processes", tags=["Azure Monitor Metrics"])
async def get_azure_application_processes():
    """
    Fetches the live process list (PID, USER, %CPU, %MEM, TIME+, COMMAND)
    from the Azure App Service worker host.
    """
    try:
        from services.azure_metrics_service import azure_metrics_service
        data = await azure_metrics_service.fetch_process_list()
        return data
    except Exception as exc:
        logger.exception(f"Error fetching Azure process list: {exc}")
        return {"status": "error", "error": str(exc), "processes": []}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )

