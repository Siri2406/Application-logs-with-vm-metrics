import asyncio
import datetime
import json
import logging
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(PROJECT_ROOT / ".env")

az_bin = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
if az_bin not in os.environ.get("PATH", ""):
    os.environ["PATH"] = f"{az_bin};{os.environ.get('PATH', '')}"

from services.azure_metrics_service import azure_metrics_service
from services.azure_log_stream import log_stream_service

output_dirs = [
    PROJECT_ROOT / "azure_logs",
    PROJECT_ROOT.parent / "azure_logs"
]

for d in output_dirs:
    d.mkdir(parents=True, exist_ok=True)

async def main():
    print("[1/6] Fetching 60-point Azure Monitor history (timespan=60m, PT1M -> 60 points)...")
    monitor_60 = await azure_metrics_service.fetch_azure_monitor_metrics(timespan_minutes=60, interval="PT1M")
    
    print("[2/6] Fetching Linux Disk Usage Detector & Mounts...")
    disk_detector = await azure_metrics_service.fetch_detector("LinuxDiskUsage")
    disk_summary = await azure_metrics_service.fetch_disk_usage()
    
    print("[3/6] Fetching Linux CPU & Memory Percentage Detectors...")
    cpu_detector = await azure_metrics_service.fetch_detector("LinuxCpuPercentage")
    mem_detector = await azure_metrics_service.fetch_detector("LinuxMemoryPercentage")
    cpu_mem_summary = await azure_metrics_service.fetch_cpu_and_memory_detector()
    
    print("[4/6] Fetching Linux Process Full List Detector (Process-level CPU & Memory)...")
    proc_detector = await azure_metrics_service.fetch_detector("LinuxProcessFullList")
    proc_summary = await azure_metrics_service.fetch_process_list()
    
    print("[5/6] Fetching Unified All Application Metrics...")
    all_metrics = await azure_metrics_service.get_all_application_metrics(force_refresh=True)
    
    print("[6/6] Fetching Live Application & Container Logs from Azure Kudu VFS...")
    kudu_logs = log_stream_service.fetch_recent_logs_from_azure(500)
    
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    files = {
        "azure_monitor_metrics_60pts.json": monitor_60,
        "azure_disk_usage.json": {
            "summary": disk_summary,
            "raw_detector": disk_detector,
            "io_ops_history": monitor_60.get("metrics", {}).get("IoReadOperationsPerSecond", {}),
        },
        "azure_cpu_metrics.json": {
            "summary": cpu_mem_summary,
            "raw_detector": cpu_detector,
            "history_points": monitor_60.get("metrics", {}).get("CpuTime", {}),
        },
        "azure_memory_metrics.json": {
            "summary": cpu_mem_summary,
            "raw_detector": mem_detector,
            "working_set_history": monitor_60.get("metrics", {}).get("AverageMemoryWorkingSet", {}),
        },
        "azure_processes_memory_cpu.json": {
            "summary": proc_summary,
            "raw_detector": proc_detector,
        },
        "azure_all_telemetry_snapshot.json": all_metrics,
        f"azure_telemetry_bundle_{ts}.json": {
            "timestamp": ts,
            "monitor_60": monitor_60,
            "cpu": cpu_mem_summary,
            "memory": cpu_mem_summary,
            "disk": disk_summary,
            "processes": proc_summary,
            "all_metrics": all_metrics,
        }
    }
    
    for filename, data in files.items():
        for d in output_dirs:
            target = d / filename
            with open(target, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        print(f"   [OK] Saved {filename}")
        
    for d in output_dirs:
        with open(d / "azure_live_application_logs.log", "w", encoding="utf-8") as f:
            f.write(kudu_logs)
        with open(d / f"azure_live_application_logs_{ts}.log", "w", encoding="utf-8") as f:
            f.write(kudu_logs)
            
    print("   [OK] Saved azure_live_application_logs.log")
    print("\nSUCCESS! All 60-point history and process-level metrics saved inside azure_logs/ directories!")

if __name__ == "__main__":
    asyncio.run(main())
