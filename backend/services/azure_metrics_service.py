import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)


class AzureAppServiceMetricsService:
    def __init__(self):
        self.subscription_id = os.getenv("AZURE_SUBSCRIPTION_ID", "902c816f-b3a0-41b7-a6e7-bea44dde47e8")
        self.resource_group = os.getenv("AZURE_RESOURCE_GROUP", "MiraAI-AuditSphere")
        self.app_service_name = os.getenv("AZURE_APP_SERVICE_NAME", "miraai-auditsphere-dev")
        self.tenant_id = os.getenv("AZURE_TENANT_ID")
        self.client_id = os.getenv("AZURE_CLIENT_ID")
        self.client_secret = os.getenv("AZURE_CLIENT_SECRET")
        self._cached_token = None
        self._token_expiry = None

    def get_token(self) -> Optional[str]:
        """
        Acquires ARM OAuth Bearer token trying:
        1. AzureCliCredential (fastest & active logged-in CLI session)
        2. DefaultAzureCredential
        3. ClientSecretCredential
        """
        from azure.identity import AzureCliCredential, ClientSecretCredential, DefaultAzureCredential

        if self._cached_token and self._token_expiry and datetime.now(timezone.utc) < self._token_expiry:
            return self._cached_token

        # 1. Try AzureCliCredential
        try:
            cred = AzureCliCredential()
            token_obj = cred.get_token("https://management.azure.com/.default")
            self._cached_token = token_obj.token
            self._token_expiry = datetime.fromtimestamp(token_obj.expires_on, tz=timezone.utc)
            return self._cached_token
        except Exception:
            pass

        # 2. Try DefaultAzureCredential
        try:
            cred = DefaultAzureCredential()
            token_obj = cred.get_token("https://management.azure.com/.default")
            self._cached_token = token_obj.token
            self._token_expiry = datetime.fromtimestamp(token_obj.expires_on, tz=timezone.utc)
            return self._cached_token
        except Exception:
            pass

        # 3. Try ClientSecretCredential
        try:
            if self.tenant_id and self.client_id and self.client_secret:
                cred = ClientSecretCredential(
                    tenant_id=self.tenant_id,
                    client_id=self.client_id,
                    client_secret=self.client_secret,
                )
                token_obj = cred.get_token("https://management.azure.com/.default")
                self._cached_token = token_obj.token
                self._token_expiry = datetime.fromtimestamp(token_obj.expires_on, tz=timezone.utc)
                return self._cached_token
        except Exception as exc:
            logger.warning(f"Could not acquire Azure Bearer token: {exc}")

        return None

    async def fetch_azure_monitor_metrics(
        self, timespan_minutes: int = 60, interval: str = "PT5M"
    ) -> Dict[str, Any]:
        """
        Fetches CPU, Memory, Disk/IO, and Network metrics from Azure Monitor REST API.
        """
        token = self.get_token()
        if not token:
            return {"status": "error", "message": "No valid Azure credentials available"}

        metric_names = [
            "CpuTime",
            "AverageMemoryWorkingSet",
            "MemoryWorkingSet",
            "IoReadOperationsPerSecond",
            "IoWriteOperationsPerSecond",
            "BytesReceived",
            "BytesSent",
            "Requests",
            "HttpResponseTime",
        ]

        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(minutes=timespan_minutes)
        timespan = f"{start_time.strftime('%Y-%m-%dT%H:%M:%SZ')}/{end_time.strftime('%Y-%m-%dT%H:%M:%SZ')}"

        url = (
            f"https://management.azure.com/subscriptions/{self.subscription_id}"
            f"/resourceGroups/{self.resource_group}/providers/Microsoft.Web/sites/{self.app_service_name}"
            f"/providers/microsoft.insights/metrics"
        )
        params = {
            "api-version": "2024-02-01",
            "metricnames": ",".join(metric_names),
            "timespan": timespan,
            "interval": interval,
            "aggregation": "Total,Average,Maximum",
        }
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    parsed: Dict[str, Any] = {}
                    for m in data.get("value", []):
                        name = m["name"]["value"]
                        unit = m.get("unit", "")
                        ts = m.get("timeseries", [{}])[0].get("data", [])
                        data_points = []
                        for pt in ts:
                            val = pt.get("average") if pt.get("average") is not None else pt.get("total")
                            if val is not None and "Memory" in name:
                                val = round(val / (1024 * 1024), 2)  # Convert bytes to MB
                            elif val is not None and "Cpu" in name:
                                val = round(val, 2)
                            elif val is not None and "Io" in name:
                                val = round(val, 2)
                            data_points.append({"timestamp": pt.get("timeStamp"), "value": val})

                        valid_points = [p for p in data_points if p["value"] is not None]
                        latest_val = valid_points[-1]["value"] if valid_points else 0.0

                        parsed[name] = {
                            "unit": "MB" if "Memory" in name else unit,
                            "latest": latest_val,
                            "points": data_points[-12:],
                        }
                    return {"status": "success", "source": "azure_monitor", "metrics": parsed}
                else:
                    return {"status": "error", "code": resp.status_code, "detail": resp.text[:400]}
            except Exception as e:
                return {"status": "error", "error": str(e)}

    async def fetch_detector(self, detector_name: str) -> Optional[Dict[str, Any]]:
        """Queries an Azure App Service Diagnostic Detector."""
        token = self.get_token()
        if not token:
            return None

        url = (
            f"https://management.azure.com/subscriptions/{self.subscription_id}"
            f"/resourceGroups/{self.resource_group}/providers/Microsoft.Web/sites/{self.app_service_name}"
            f"/detectors/{detector_name}?api-version=2022-03-01"
        )
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.json()
                logger.warning(f"Detector {detector_name} returned status {resp.status_code}: {resp.text[:200]}")
                return None
            except Exception as e:
                logger.warning(f"Failed to fetch detector {detector_name}: {repr(e)}")
                return None

    async def fetch_disk_usage(self) -> Dict[str, Any]:
        """Fetches mount-level disk usage percentages from LinuxDiskUsage detector."""
        data = await self.fetch_detector("LinuxDiskUsage")
        if not data:
            return {"status": "unavailable", "mounts": []}

        mounts = []
        datasets = data.get("properties", {}).get("dataset", [])
        for ds in datasets:
            table = ds.get("table", {})
            cols = [c.get("columnName") for c in table.get("columns", [])]
            rows = table.get("rows", [])
            if "MountPath" in cols and "diskUsage" in cols and rows:
                mount_idx = cols.index("MountPath")
                usage_idx = cols.index("diskUsage")
                host_idx = cols.index("Host") if "Host" in cols else -1
                time_idx = cols.index("Time") if "Time" in cols else -1

                latest_row = rows[-1]
                mounts.append({
                    "mount_path": latest_row[mount_idx],
                    "usage_percent": float(latest_row[usage_idx]),
                    "host": latest_row[host_idx] if host_idx != -1 else "unknown",
                    "timestamp": latest_row[time_idx] if time_idx != -1 else "",
                })

        return {"status": "success", "mounts": mounts}

    async def fetch_cpu_and_memory_detector(self) -> Dict[str, Any]:
        """Fetches machine-level CPU and physical memory usage % from Linux detectors."""
        cpu_data, mem_data = await asyncio.gather(
            self.fetch_detector("LinuxCpuPercentage"),
            self.fetch_detector("LinuxMemoryPercentage"),
        )

        res = {
            "percent_cpu_used": 0.0,
            "percent_memory_used": 0.0,
            "average_memory_percent": 0.0,
        }

        if cpu_data:
            datasets = cpu_data.get("properties", {}).get("dataset", [])
            for ds in datasets:
                table = ds.get("table", {})
                cols = [c.get("columnName") for c in table.get("columns", [])]
                rows = table.get("rows", [])
                if "PercentCpuUsed" in cols and rows:
                    idx = cols.index("PercentCpuUsed")
                    res["percent_cpu_used"] = float(rows[-1][idx])

        if mem_data:
            datasets = mem_data.get("properties", {}).get("dataset", [])
            for ds in datasets:
                table = ds.get("table", {})
                cols = [c.get("columnName") for c in table.get("columns", [])]
                rows = table.get("rows", [])
                if "PercentPhysicalMemoryUsed" in cols and rows:
                    idx = cols.index("PercentPhysicalMemoryUsed")
                    res["percent_memory_used"] = float(rows[-1][idx])
                elif "AverageMemory" in cols and rows:
                    idx = cols.index("AverageMemory")
                    res["average_memory_percent"] = round(float(rows[-1][idx]), 2)

        return res

    async def fetch_process_list(self) -> Dict[str, Any]:
        """
        Parses live process list from LinuxProcessFullList detector:
        PID, USER, %CPU, %MEM, TIME+, COMMAND.
        """
        data = await self.fetch_detector("LinuxProcessFullList")
        if not data:
            return {"status": "unavailable", "processes": []}

        datasets = data.get("properties", {}).get("dataset", [])
        raw_table_json = None
        for ds in datasets:
            rows = ds.get("table", {}).get("rows", [])
            for row in rows:
                if len(row) >= 4 and isinstance(row[3], str) and "Table_" in row[3]:
                    raw_table_json = row[3]
                    break
            if raw_table_json:
                break

        if not raw_table_json:
            return {"status": "empty", "processes": []}

        try:
            tables = json.loads(raw_table_json)
            if not tables or not isinstance(tables, list):
                return {"status": "empty", "processes": []}

            inner_table = tables[0].get("table", {})
            rows = inner_table.get("rows", [])
            if not rows:
                return {"status": "empty", "processes": []}

            latest_entry = rows[-1]
            timestamp = latest_entry[0]
            pre_content = latest_entry[1]

            pre_content = re.sub(r"</?PRE>", "", pre_content, flags=re.IGNORECASE)
            lines = [l.strip() for l in pre_content.split("\n") if l.strip()]

            parsed_processes = []
            for line in lines:
                parts = line.split(None, 11)
                if not parts or parts[0] == "PID":
                    continue
                if len(parts) >= 12:
                    try:
                        parsed_processes.append({
                            "pid": int(parts[0]),
                            "user": parts[1],
                            "priority": parts[2],
                            "nice": parts[3],
                            "virt": parts[4],
                            "res": parts[5],
                            "shr": parts[6],
                            "state": parts[7],
                            "cpu_percent": float(parts[8]),
                            "memory_percent": float(parts[9]),
                            "time": parts[10],
                            "command": parts[11],
                        })
                    except Exception:
                        continue

            # Sort descending by memory % and CPU %
            sorted_procs = sorted(parsed_processes, key=lambda x: (x["cpu_percent"], x["memory_percent"]), reverse=True)
            return {
                "status": "success",
                "timestamp": timestamp,
                "total_processes": len(sorted_procs),
                "processes": sorted_procs,
            }
        except Exception as e:
            return {"status": "error", "error": str(e), "processes": []}

    async def get_all_application_metrics(self, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Unified method fetching:
        - Azure Monitor platform metrics (CPU time, Memory working set, IO, Network)
        - Linux detector metrics (Disk mount usage %, Machine CPU %, Machine RAM %)
        - Process table (PID, USER, %CPU, %MEM, COMMAND)
        Caches telemetry for 45 seconds for sub-millisecond UI responses.
        """
        now = datetime.now(timezone.utc)
        if (
            not force_refresh
            and hasattr(self, "_cached_telemetry")
            and self._cached_telemetry
            and hasattr(self, "_telemetry_cached_at")
            and self._telemetry_cached_at
            and (now - self._telemetry_cached_at).total_seconds() < 45
        ):
            return self._cached_telemetry

        monitor_task = self.fetch_azure_monitor_metrics()
        disk_task = self.fetch_disk_usage()
        cpu_mem_task = self.fetch_cpu_and_memory_detector()
        procs_task = self.fetch_process_list()

        monitor_res, disk_res, cpu_mem_res, procs_res = await asyncio.gather(
            monitor_task, disk_task, cpu_mem_task, procs_task
        )

        m_metrics = monitor_res.get("metrics", {}) if monitor_res.get("status") == "success" else {}

        # Combine into structured view
        cpu_info = {
            "percent_cpu_used": cpu_mem_res.get("percent_cpu_used", 0.0),
            "cpu_time_seconds": m_metrics.get("CpuTime", {}).get("latest", 0.0),
            "history": m_metrics.get("CpuTime", {}).get("points", []),
        }

        memory_info = {
            "percent_physical_used": cpu_mem_res.get("percent_memory_used", 0.0),
            "average_memory_percent": cpu_mem_res.get("average_memory_percent", 0.0),
            "working_set_mb": m_metrics.get("MemoryWorkingSet", {}).get("latest", 0.0),
            "average_working_set_mb": m_metrics.get("AverageMemoryWorkingSet", {}).get("latest", 0.0),
            "history": m_metrics.get("AverageMemoryWorkingSet", {}).get("points", []),
        }

        disk_info = {
            "mounts": disk_res.get("mounts", []),
            "io_read_ops_sec": m_metrics.get("IoReadOperationsPerSecond", {}).get("latest", 0.0),
            "io_write_ops_sec": m_metrics.get("IoWriteOperationsPerSecond", {}).get("latest", 0.0),
        }

        network_info = {
            "bytes_received": m_metrics.get("BytesReceived", {}).get("latest", 0.0),
            "bytes_sent": m_metrics.get("BytesSent", {}).get("latest", 0.0),
            "requests": m_metrics.get("Requests", {}).get("latest", 0),
            "response_time_seconds": m_metrics.get("HttpResponseTime", {}).get("latest", 0.0),
        }

        result = {
            "app_service": self.app_service_name,
            "resource_group": self.resource_group,
            "subscription_id": self.subscription_id,
            "timestamp": now.isoformat(),
            "cpu": cpu_info,
            "memory": memory_info,
            "disk": disk_info,
            "network": network_info,
            "processes": procs_res.get("processes", []),
            "total_processes": procs_res.get("total_processes", 0),
            "raw_azure_monitor": monitor_res,
        }

        self._cached_telemetry = result
        self._telemetry_cached_at = now
        return result


azure_metrics_service = AzureAppServiceMetricsService()


if __name__ == "__main__":
    async def main():
        print("Testing Azure Metrics Service...")
        res = await azure_metrics_service.get_all_application_metrics()
        print(f"App Service: {res['app_service']}")
        print(f"CPU: {res['cpu']}")
        print(f"Memory: {res['memory']}")
        print(f"Disk: {res['disk']}")
        print(f"Processes count: {res['total_processes']}")
        if res['processes']:
            print("Top 3 processes:")
            for p in res['processes'][:3]:
                print("  ", p)

    asyncio.run(main())
