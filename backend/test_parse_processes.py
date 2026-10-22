import json
import re
from datetime import datetime, timezone, timedelta
import httpx
from azure.identity import AzureCliCredential, DefaultAzureCredential

def parse_detector_processes(raw_table_json):
    """
    Parses the top-like table from LinuxProcessFullList into structured dicts:
    PID, USER, PR, NI, VIRT, RES, SHR, S, %CPU, %MEM, TIME+, COMMAND
    """
    try:
        tables = json.loads(raw_table_json)
    except Exception:
        return []

    if not tables or not isinstance(tables, list):
        return []

    # Get rows from the inner table
    inner_table = tables[0].get("table", {})
    rows = inner_table.get("rows", [])
    if not rows:
        return []

    # Pick the latest timestamp entry
    latest_entry = rows[-1]  # [timestamp, "<PRE>..."]
    timestamp = latest_entry[0]
    pre_content = latest_entry[1]

    # Clean <PRE> and </PRE>
    pre_content = re.sub(r"</?PRE>", "", pre_content, flags=re.IGNORECASE)
    lines = [l.strip() for l in pre_content.split("\n") if l.strip()]

    parsed_processes = []
    # Header line usually has: PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ COMMAND
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
        elif len(parts) >= 6:
            parsed_processes.append({
                "pid": parts[0],
                "command": parts[-1],
                "raw": line
            })

    return {"timestamp": timestamp, "processes": parsed_processes}

# Let's test this
cred = AzureCliCredential()
token = cred.get_token("https://management.azure.com/.default").token
sub = "902c816f-b3a0-41b7-a6e7-bea44dde47e8"
rg = "MiraAI-AuditSphere"
app = "miraai-auditsphere-dev"
headers = {"Authorization": f"Bearer {token}"}

# Detector fetch
url = f"https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}/detectors/LinuxProcessFullList?api-version=2022-03-01"
r = httpx.get(url, headers=headers, timeout=15)
if r.status_code == 200:
    datasets = r.json().get("properties", {}).get("dataset", [])
    for ds in datasets:
        rows = ds.get("table", {}).get("rows", [])
        for row in rows:
            if len(row) >= 4 and isinstance(row[3], str) and "Table_" in row[3]:
                result = parse_detector_processes(row[3])
                print(f"Parsed {len(result['processes'])} processes from timestamp {result['timestamp']}:")
                for p in result['processes'][:5]:
                    print("  ", p)
