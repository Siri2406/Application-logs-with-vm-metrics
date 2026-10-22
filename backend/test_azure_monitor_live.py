import httpx
from datetime import datetime, timezone, timedelta
from azure.identity import AzureCliCredential

cred = AzureCliCredential()
token = cred.get_token("https://management.azure.com/.default").token

sub = "902c816f-b3a0-41b7-a6e7-bea44dde47e8"
rg = "MiraAI-AuditSphere"
app = "miraai-auditsphere-dev"
headers = {"Authorization": f"Bearer {token}"}

end = datetime.now(timezone.utc)
start = end - timedelta(minutes=60)
timespan = f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')}/{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"

metrics_url = f"https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}/providers/microsoft.insights/metrics"
p = {
    "api-version": "2024-02-01",
    "metricnames": "CpuTime,AverageMemoryWorkingSet,MemoryWorkingSet,IoReadOperationsPerSecond,IoWriteOperationsPerSecond,BytesReceived,BytesSent,Requests,HttpResponseTime",
    "timespan": timespan,
    "interval": "PT5M",
    "aggregation": "Total,Average,Maximum",
}
r = httpx.get(metrics_url, params=p, headers=headers, timeout=15)
print("Status:", r.status_code)
if r.status_code == 200:
    for m in r.json().get("value", []):
        name = m["name"]["value"]
        unit = m.get("unit")
        ts = m.get("timeseries", [{}])[0].get("data", [])
        valid = [pt for pt in ts if any(pt.get(k) is not None for k in ["average", "total", "maximum"])]
        last = valid[-1] if valid else None
        print(f"Metric: {name:28} | Unit: {unit:12} | Valid points: {len(valid):2} | Latest: {last}")
else:
    print(r.text)
