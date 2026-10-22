import asyncio
from services.azure_metrics_service import azure_metrics_service

async def test():
    data = await azure_metrics_service.get_all_application_metrics()
    print("=" * 65)
    print("AZURE MONITOR & LINUX DETECTOR TELEMETRY REPORT")
    print("=" * 65)
    print("App Service      :", data["app_service"])
    print("Resource Group   :", data["resource_group"])
    print("Subscription ID  :", data["subscription_id"])
    print("Timestamp        :", data["timestamp"])
    print("-" * 65)
    print("CPU TELEMETRY:")
    print("  Host CPU Used %       :", data["cpu"]["percent_cpu_used"], "%")
    print("  App Service CPU Time  :", data["cpu"]["cpu_time_seconds"], "seconds (over 5m interval)")
    print("  CPU History Data Points:", len(data["cpu"]["history"]))
    print("-" * 65)
    print("MEMORY TELEMETRY:")
    print("  Host Physical RAM %   :", data["memory"]["percent_physical_used"], "%")
    print("  App Average RAM %     :", data["memory"]["average_memory_percent"], "%")
    print("  Working Set (Latest)  :", data["memory"]["working_set_mb"], "MB")
    print("  Avg Working Set       :", data["memory"]["average_working_set_mb"], "MB")
    print("-" * 65)
    print("DISK & STORAGE TELEMETRY:")
    for m in data["disk"]["mounts"]:
        print(f"  Partition '{m['mount_path']}' on host '{m['host']}': {m['usage_percent']}% used")
    print("  IO Read Operations/sec :", data["disk"]["io_read_ops_sec"], "ops/s")
    print("  IO Write Operations/sec:", data["disk"]["io_write_ops_sec"], "ops/s")
    print("-" * 65)
    print("NETWORK & REQUESTS:")
    print("  Bytes Received        :", data["network"]["bytes_received"], "bytes")
    print("  Bytes Sent            :", data["network"]["bytes_sent"], "bytes")
    print("  Total Requests        :", data["network"]["requests"])
    print("  Response Time         :", data["network"]["response_time_seconds"], "s")
    print("-" * 65)
    print(f"PROCESS-LEVEL METRICS ({data['total_processes']} running processes):")
    print(f"{'PID':>8} {'USER':>8} {'%CPU':>6} {'%MEM':>6} {'TIME+':>10}  COMMAND")
    for p in data["processes"][:10]:
        print(f"{p['pid']:8d} {p['user']:>8} {p['cpu_percent']:6.1f} {p['memory_percent']:6.1f} {p['time']:>10}  {p['command']}")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(test())
