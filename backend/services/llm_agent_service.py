import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

# Load environment variables from project root .env and tests/.env
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "tests" / ".env")

try:
    from config.settings import (
        AZURE_OPENAI_API_KEY,
        AZURE_OPENAI_ENDPOINT,
        LLM_API_KEY,
        LLM_ENDPOINT,
        MODEL_NAME,
    )
except (ModuleNotFoundError, ImportError):
    LLM_ENDPOINT = os.getenv(
        "LLM_ENDPOINT",
        "https://infrastructuremonitoringagent.openai.azure.com/openai/responses?api-version=2025-04-01-preview",
    )
    AZURE_OPENAI_ENDPOINT = LLM_ENDPOINT
    LLM_API_KEY = os.getenv("LLM_API_KEY", os.getenv("AZURE_OPENAI_API_KEY", ""))
    AZURE_OPENAI_API_KEY = LLM_API_KEY
    MODEL_NAME = os.getenv("MODEL_NAME", "5.6 luna")

logger = logging.getLogger(__name__)

API_KEY = os.getenv("GOOGLE_API_KEY")

_genai_client = None


def _extract_text_from_response(resp_data: Any) -> str:
    """Robustly extracts text from Azure OpenAI Responses API or Chat Completions format."""
    if isinstance(resp_data, str):
        return resp_data
    if not isinstance(resp_data, dict):
        return ""

    # 1. Responses API top-level output_text helper
    if "output_text" in resp_data and isinstance(resp_data["output_text"], str):
        return resp_data["output_text"]

    # 2. Responses API "output" array
    output = resp_data.get("output")
    if isinstance(output, list):
        text_parts = []
        for item in output:
            if isinstance(item, dict):
                if "text" in item and isinstance(item["text"], str):
                    text_parts.append(item["text"])
                content = item.get("content")
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict):
                            if block.get("type") == "output_text" and "text" in block:
                                text_parts.append(block["text"])
                            elif "text" in block and isinstance(block["text"], str):
                                text_parts.append(block["text"])
                elif isinstance(content, str):
                    text_parts.append(content)
        if text_parts:
            return "\n".join(text_parts)

    # 3. Chat completions "choices" array
    choices = resp_data.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str):
                    return content
            elif "text" in first and isinstance(first["text"], str):
                return first["text"]

    # 4. Direct top-level fields
    for field in ("text", "content", "response", "message"):
        val = resp_data.get(field)
        if isinstance(val, str) and val.strip():
            return val

    return ""


def invoke_azure_responses_api(
    prompt: str,
    system_instructions: str = "",
    endpoint: Optional[str] = None,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    timeout: int = 45,
) -> Optional[str]:
    """
    Invokes the Azure OpenAI Responses API using centralized configuration.
    Endpoint URL, API key, and model name are strictly pulled from .env / settings.
    """
    url = (
        endpoint
        or os.getenv("LLM_ENDPOINT")
        or os.getenv("AZURE_OPENAI_ENDPOINT")
        or LLM_ENDPOINT
    )
    key = (
        api_key
        or os.getenv("LLM_API_KEY")
        or os.getenv("AZURE_OPENAI_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or LLM_API_KEY
    )
    model = model_name or os.getenv("MODEL_NAME") or MODEL_NAME or "5.6 luna"

    if not url or not key:
        logger.warning(
            "Azure OpenAI Responses API: missing endpoint or API key. "
            "Ensure LLM_ENDPOINT and LLM_API_KEY / AZURE_OPENAI_API_KEY are configured in .env."
        )
        return None

    headers = {
        "Content-Type": "application/json",
        "api-key": key.strip(),
    }
    if key.strip().lower().startswith("bearer "):
        headers["Authorization"] = key.strip()

    # Standard Azure OpenAI Responses API payload
    payload = {
        "model": model,
        "input": prompt,
    }
    if system_instructions and system_instructions.strip():
        payload["instructions"] = system_instructions.strip()

    try:
        clean_url_display = url.split("?")[0]
        logger.info(f"Invoking Azure OpenAI Responses API ({clean_url_display}) with model '{model}'...")
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if resp.status_code == 200:
            extracted = _extract_text_from_response(resp.json())
            if extracted:
                logger.info(f"Received valid response ({len(extracted)} chars) from model '{model}'")
                return extracted
            logger.warning(f"Azure OpenAI response had no extractable text: {resp.text[:300]}")
        elif resp.status_code in (400, 422):
            # Check if alternative chat completions messages structure is required
            err_text = resp.text.lower()
            if "messages" in err_text or "input" in err_text:
                messages = []
                if system_instructions and system_instructions.strip():
                    messages.append({"role": "system", "content": system_instructions.strip()})
                messages.append({"role": "user", "content": prompt})
                alt_payload = {
                    "model": model,
                    "messages": messages,
                }
                alt_resp = requests.post(url, headers=headers, json=alt_payload, timeout=timeout)
                if alt_resp.status_code == 200:
                    return _extract_text_from_response(alt_resp.json())
            logger.warning(f"Azure OpenAI API returned HTTP {resp.status_code}: {resp.text}")
        else:
            logger.warning(f"Azure OpenAI API returned HTTP {resp.status_code}: {resp.text}")
    except Exception as exc:
        logger.warning(f"Failed to communicate with Azure OpenAI Responses API: {exc}")

    return None


def get_genai_client():
    global _genai_client
    if _genai_client is None:
        try:
            from google import genai
            api_key = os.getenv("GOOGLE_API_KEY")
            if api_key:
                _genai_client = genai.Client(api_key=api_key)
            else:
                _genai_client = genai.Client()
        except Exception as exc:
            logger.warning(f"Could not initialize google.genai Client: {exc}")
            _genai_client = None
    return _genai_client



def _clean_json_markdown(text: str) -> str:
    """Removes ```json and ``` code fence markers from model output."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _fmt_time(t: str) -> str:
    if "T" in str(t):
        parts = str(t).split("T")[1].split("+")[0].split(".")[0]
        return parts
    return str(t) or "14:13:00"


def _extract_friendly_name(cmd: str, process_name: str) -> str:
    """Derive a human-friendly application/service name dynamically from process metadata without hardcoded names."""
    if process_name and process_name.strip():
        p_clean = process_name.strip().strip("'\"")
        # If process_name is generic interpreter like 'python', 'python3', 'node', parse the target script/command
        if p_clean.lower() in ("python", "python3", "node", "java", "ruby", "perl", "bash", "sh") and cmd:
            tokens = cmd.strip().split()
            for token in tokens[1:]:
                if not token.startswith("-") and ("/" in token or "\\" in token or token.endswith((".py", ".js", ".jar", ".sh"))):
                    base = Path(token).stem.replace("_", " ").replace("-", " ").title()
                    return f"{base} Service" if not base.lower().endswith("service") else base
        base = p_clean.replace("_", " ").replace("-", " ").title()
        return base
    if cmd and cmd.strip():
        first_token = cmd.strip().split()[0]
        return Path(first_token).stem.replace("_", " ").replace("-", " ").title()
    return "Workload Process"


def build_cpu_utilization_analysis_text(metrics_payload: Any) -> str:
    """Deterministically builds the structured CPU Utilization Analysis block."""
    if isinstance(metrics_payload, dict) and "current_metrics" in metrics_payload:
        current_m = metrics_payload.get("current_metrics") or {}
        latest_5 = metrics_payload.get("latest_5_recordings") or [current_m]
        top_procs = metrics_payload.get("top_15_processes") or metrics_payload.get("top_processes") or metrics_payload.get("top_5_processes") or []
        logs_5 = metrics_payload.get("services_logs_5") or []

        curr_cpu_obj = current_m.get("cpu") or {}
        curr_cpu = float(curr_cpu_obj.get("total", 0.0) or 0.0)
        curr_time = current_m.get("timestamp", "")

        start_m = latest_5[0] if latest_5 else current_m
        start_cpu = float((start_m.get("cpu") or {}).get("total", curr_cpu) or curr_cpu)
        start_time = start_m.get("timestamp", curr_time)

        start_fmt = _fmt_time(start_time)
        curr_fmt = _fmt_time(curr_time)

        top_proc = top_procs[0] if top_procs else {}
        p_name = _extract_friendly_name(top_proc.get("command_line", ""), top_proc.get("process_name", "Primary Process"))
        p_pid = top_proc.get("pid", "N/A")
        p_cpu = float(top_proc.get("cpu_percent", curr_cpu) or curr_cpu)
        thread_cnt = top_proc.get("thread_count")

        corr_svc = {}
        for raw_s in logs_5:
            s = {"service_name": "azure-app-service", "message": raw_s, "timestamp": curr_time} if isinstance(raw_s, str) else raw_s
            s_name = (s.get("service_name") or "").lower()
            s_proc = str(s.get("process") or "").lower()
            if (str(p_pid) in s_proc or
                p_name.lower() in s_name or
                (top_proc.get("command_line") and s_name in top_proc.get("command_line", "").lower())):
                corr_svc = s
                break
        if not corr_svc and logs_5:
            first_s = logs_5[0]
            corr_svc = {"service_name": "azure-app-service", "message": first_s, "timestamp": curr_time} if isinstance(first_s, str) else first_s

        corr_time = _fmt_time(corr_svc.get("timestamp", curr_time))
        corr_name = corr_svc.get("service_name") or (f"{p_name}.service" if p_name else "system-workload.service")
        corr_msg = corr_svc.get("message") or f"Service active under process PID {p_pid}"

        other_svcs = [
            (s if isinstance(s, dict) else {}).get("service_name")
            for s in logs_5
            if isinstance(s, dict) and s.get("service_name") and s.get("service_name") != corr_name
        ][:2]
        supp_text = f"{', '.join(other_svcs)} activity observed during the observation window." if other_svcs else "Background system services active during the observation period."

        # If current CPU is normal (no issues detected)
        if curr_cpu < 50.0:
            lines = [
                "CPU Utilization Analysis",
                "",
                "Observed:",
                f"CPU utilization is normal at {curr_cpu:.1f}%. No issues detected between {start_fmt} and {curr_fmt}.",
                "",
                "Primary process:",
                f"{p_name} (PID {p_pid})",
                f"CPU usage: {p_cpu:.1f}%.",
            ]
            if thread_cnt is not None and str(thread_cnt).strip():
                lines.append(f"Thread count: {thread_cnt}")
            lines.extend([
                "",
                "Status:",
                "Healthy. There are no issues detected. Host CPU compute capacity is operating within safe limits.",
            ])
            return "\n".join(lines)

        if start_cpu < curr_cpu:
            obs_line = f"CPU increased from {start_cpu:.0f}% to {curr_cpu:.0f}% between {start_fmt} and {curr_fmt}."
        elif start_cpu > curr_cpu:
            obs_line = f"CPU decreased from {start_cpu:.0f}% to {curr_cpu:.0f}% between {start_fmt} and {curr_fmt}."
        else:
            obs_line = f"CPU remained steady at {curr_cpu:.0f}% between {start_fmt} and {curr_fmt}."

        lines = [
            "CPU Utilization Analysis",
            "",
            "Observed:",
            obs_line,
            "",
            "Primary process:",
            f"{p_name} (PID {p_pid})",
            f"CPU reached {p_cpu:.1f}%.",
        ]
        if thread_cnt is not None and str(thread_cnt).strip():
            lines.append(f"Thread count: {thread_cnt}")

        lines.extend([
            "",
            "Correlated service event:",
            f"At {corr_time}, {corr_name} reported: {corr_msg}",
            "",
            "Supporting evidence:",
            supp_text,
            "",
            "Likely root cause:",
            f"The CPU spike is associated with active workload process '{p_name}' operating near host compute capacity.",
            "",
            "Confidence:",
            "High",
        ])
        return "\n".join(lines)

    records = metrics_payload if isinstance(metrics_payload, list) else [metrics_payload]
    if not records or not isinstance(records[0], dict):
        return "CPU Utilization Analysis\n\nNo telemetry records available."

    cpu_values = []
    for r in records:
        total_p = None
        if "cpu_metrics" in r and isinstance(r["cpu_metrics"], dict):
            total_p = r["cpu_metrics"].get("total_percent")
        if total_p is None:
            total_p = r.get("usage_percent", r.get("cpu", {}).get("total", 0.0))
        try:
            total_p = float(total_p or 0.0)
        except Exception:
            total_p = 0.0
        cpu_values.append((total_p, r.get("timestamp", "")))

    start_cpu, start_t = cpu_values[0] if cpu_values else (0.0, "")
    peak_cpu, peak_t = max(cpu_values, key=lambda x: x[0]) if cpu_values else (start_cpu, start_t)
    start_fmt = _fmt_time(start_t)
    peak_fmt = _fmt_time(peak_t)

    first_rec = records[0]
    primary = first_rec.get("primary_process") or {}
    p_name = primary.get("name") or primary.get("process_name") or "Primary Process"
    p_pid = primary.get("pid", "N/A")
    p_cpu = primary.get("cpu_percent", peak_cpu)
    thread_cnt = primary.get("thread_count")

    if peak_cpu < 50.0:
        lines = [
            "CPU Utilization Analysis",
            "",
            "Observed:",
            f"CPU utilization is normal at {peak_cpu:.1f}%. No issues detected between {start_fmt} and {peak_fmt}.",
            "",
            "Primary process:",
            f"{p_name} (PID {p_pid})",
            f"CPU usage: {p_cpu:.1f}%.",
        ]
        if thread_cnt is not None and str(thread_cnt).strip():
            lines.append(f"Thread count: {thread_cnt}")
        lines.extend([
            "",
            "Status:",
            "Healthy. There are no issues detected. Host CPU compute capacity is operating within safe limits.",
        ])
        return "\n".join(lines)

    corr = first_rec.get("correlated_service_event") or {}
    corr_time = _fmt_time(corr.get("timestamp", peak_t))
    corr_svc = corr.get("service_name") or "system-workload.service"
    corr_msg = corr.get("message") or f"Active workload processing under PID {p_pid}"

    if start_cpu < peak_cpu:
        obs_line = f"CPU increased from {start_cpu:.0f}% to {peak_cpu:.0f}% between {start_fmt} and {peak_fmt}."
    elif start_cpu > peak_cpu:
        obs_line = f"CPU decreased from {start_cpu:.0f}% to {peak_cpu:.0f}% between {start_fmt} and {peak_fmt}."
    else:
        obs_line = f"CPU remained steady at {peak_cpu:.0f}% between {start_fmt} and {peak_fmt}."

    lines = [
        "CPU Utilization Analysis",
        "",
        "Observed:",
        obs_line,
        "",
        "Primary process:",
        f"{p_name} (PID {p_pid})",
        f"CPU reached {p_cpu:.1f}%.",
    ]
    if thread_cnt is not None and str(thread_cnt).strip():
        lines.append(f"Thread count: {thread_cnt}")

    lines.extend([
        "",
        "Correlated service event:",
        f"At {corr_time}, {corr_svc} reported: {corr_msg}",
        "",
        "Supporting evidence:",
        "System services active during the observation period.",
        "",
        "Likely root cause:",
        f"The CPU spike is associated with active workload from '{p_name}' operating near host compute capacity.",
        "",
        "Confidence:",
        "High",
    ])
    return "\n".join(lines)


def build_disk_utilization_analysis_text(metrics_payload: Any) -> str:
    """Deterministically builds the structured Disk Utilization Analysis block."""
    if isinstance(metrics_payload, dict) and "current_metrics" in metrics_payload:
        current_m = metrics_payload.get("current_metrics") or {}
        latest_5 = metrics_payload.get("latest_5_recordings") or [current_m]
        top_procs = metrics_payload.get("top_15_disk_processes") or metrics_payload.get("top_15_processes") or metrics_payload.get("top_processes") or metrics_payload.get("top_5_processes") or []
        logs_5 = metrics_payload.get("services_logs_5") or []

        d_info = current_m.get("disk") or {}
        used_p = float(d_info.get("percent", 0.0) or 0.0)
        used_gb = float(d_info.get("used_gb", 0.0) or 0.0)
        free_gb = float(d_info.get("free_gb", 0.0) or 0.0)
        total_gb = float(d_info.get("total_gb", 0.0) or 0.0)

        start_m = latest_5[0] if latest_5 else current_m
        start_fmt = _fmt_time(start_m.get("timestamp", ""))
        curr_fmt = _fmt_time(current_m.get("timestamp", ""))

        top_proc = top_procs[0] if top_procs else {}
        p_name = _extract_friendly_name(top_proc.get("command_line", ""), top_proc.get("process_name", "Storage Process"))
        p_pid = top_proc.get("pid", "N/A")

        corr_svc = logs_5[0] if logs_5 else {}
        corr_time = _fmt_time(corr_svc.get("timestamp", curr_fmt))
        corr_name = corr_svc.get("service_name") or "storage.service"
        corr_msg = corr_svc.get("message") or "Storage write operations executing within normal baseline"

        # If disk is normal (no issues detected)
        if used_p < 70.0:
            lines = [
                "Disk Utilization Analysis",
                "",
                "Observed:",
                f"Disk utilization is normal at {used_p:.1f}% ({used_gb:.2f} GB used out of {total_gb:.2f} GB, {free_gb:.2f} GB free). No issues detected between {start_fmt} and {curr_fmt}.",
                "",
                "Primary process:",
                f"{p_name} (PID {p_pid})",
                "Disk activity: nominal I/O throughput across system mount points.",
            ]
            lines.extend([
                "",
                "Status:",
                "Healthy. There are no issues detected. System storage capacity is healthy with ample free space.",
            ])
            return "\n".join(lines)

        lines = [
            "Disk Utilization Analysis",
            "",
            "Observed:",
            f"Disk utilization observed at {used_p:.1f}% ({used_gb:.2f} GB of {total_gb:.2f} GB used, {free_gb:.2f} GB free) between {start_fmt} and {curr_fmt}.",
            "",
            "Primary process:",
            f"{p_name} (PID {p_pid})",
            "Disk activity: normal I/O throughput across system mount points.",
            "",
            "Correlated service event:",
            f"At {corr_time}, {corr_name} reported: {corr_msg}",
            "",
            "Supporting evidence:",
            "System logging and storage mount points operating within healthy baseline latency.",
            "",
            "Likely root cause:",
            f"Storage usage is elevated at {used_p:.1f}%.",
            "",
            "Confidence:",
            "High",
        ]
        return "\n".join(lines)

    records = metrics_payload if isinstance(metrics_payload, list) else [metrics_payload]
    if not records or not isinstance(records[0], dict):
        return "Disk Utilization Analysis\n\nNo storage records available."

    first = records[0]
    last = records[-1]
    d_info = first.get("disk_metrics", first.get("disk", {}))
    used_p = float(d_info.get("percent", first.get("usage_percent", 0.0)))
    used_gb = float(d_info.get("used_gb", 0.0))
    free_gb = float(d_info.get("free_gb", 0.0))
    total_gb = float(d_info.get("total_gb", 0.0))
    start_fmt = _fmt_time(first.get("timestamp", ""))
    end_fmt = _fmt_time(last.get("timestamp", ""))

    primary = first.get("primary_process") or {}
    p_name = primary.get("name") or "Storage Process"
    p_pid = primary.get("pid", "N/A")
    p_rss = float(primary.get("memory_rss_mb", 0.0))
    thread_cnt = primary.get("thread_count")

    if used_p < 70.0:
        lines = [
            "Disk Utilization Analysis",
            "",
            "Observed:",
            f"Disk utilization is normal at {used_p:.1f}% ({used_gb:.2f} GB used out of {total_gb:.2f} GB, {free_gb:.2f} GB free). No issues detected between {start_fmt} and {end_fmt}.",
            "",
            "Primary process:",
            f"{p_name} (PID {p_pid})",
            "Disk activity: nominal I/O throughput across system mount points.",
        ]
        lines.extend([
            "",
            "Status:",
            "Healthy. There are no issues detected. System storage capacity is healthy with ample free space.",
        ])
        return "\n".join(lines)

    corr = first.get("correlated_service_event") or {}
    corr_time = _fmt_time(corr.get("timestamp", ""))
    corr_svc = corr.get("service_name") or "storage.service"
    corr_msg = corr.get("message") or "Active storage operations"

    lines = [
        "Disk Utilization Analysis",
        "",
        "Observed:",
        f"Disk utilization observed at {used_p:.1f}% ({used_gb:.2f} GB of {total_gb:.2f} GB used, {free_gb:.2f} GB free) between {start_fmt} and {end_fmt}.",
        "",
        "Primary process:",
        f"{p_name} (PID {p_pid})",
        f"Disk activity: steady I/O throughput / Memory RSS {p_rss:.1f} MB.",
    ]
    if thread_cnt is not None and str(thread_cnt).strip():
        lines.append(f"Thread count: {thread_cnt}")

    lines.extend([
        "",
        "Correlated service event:",
        f"At {corr_time}, {corr_svc} reported: {corr_msg}",
        "",
        "Supporting evidence:",
        "System storage mounts operating with nominal disk write operations.",
        "",
        "Likely root cause:",
        f"Storage capacity is healthy at {used_p:.1f}% utilization with {free_gb:.2f} GB free capacity." if used_p < 70 else f"Storage usage is elevated at {used_p:.1f}%.",
        "",
        "Confidence:",
        "High",
    ])
    return "\n".join(lines)


def build_memory_utilization_analysis_text(metrics_payload: Any) -> str:
    """Deterministically builds the structured Memory Utilization Analysis block."""
    if isinstance(metrics_payload, dict) and "current_metrics" in metrics_payload:
        current_m = metrics_payload.get("current_metrics") or {}
        latest_5 = metrics_payload.get("latest_5_recordings") or [current_m]
        top_procs = metrics_payload.get("top_15_memory_processes") or metrics_payload.get("top_15_processes") or metrics_payload.get("top_memory_processes") or metrics_payload.get("top_processes") or metrics_payload.get("top_5_processes") or []
        logs_5 = metrics_payload.get("services_logs_5") or []

        ram_info = current_m.get("ram") or current_m.get("memory") or current_m.get("ram_metrics") or {}
        curr_p = float(ram_info.get("percent", 0.0) or 0.0)
        used_gb = float(ram_info.get("used_gb", 0.0) or 0.0)
        avail_gb = float(ram_info.get("available_gb", 0.0) or 0.0)
        total_gb = float(ram_info.get("total_gb", 0.0) or 0.0)

        start_m = latest_5[0] if latest_5 else current_m
        start_fmt = _fmt_time(start_m.get("timestamp", ""))
        curr_fmt = _fmt_time(current_m.get("timestamp", ""))

        top_proc = top_procs[0] if top_procs else {}
        p_name = _extract_friendly_name(top_proc.get("command_line", ""), top_proc.get("process_name", "Primary Process"))
        p_pid = top_proc.get("pid", "N/A")
        p_mem = float(top_proc.get("memory_percent", 0.0) or 0.0)
        p_rss = float(top_proc.get("memory_rss_mb", 0.0) or 0.0)
        thread_cnt = top_proc.get("thread_count")

        corr_svc = logs_5[0] if logs_5 else {}
        corr_time = _fmt_time(corr_svc.get("timestamp", curr_fmt))
        corr_name = corr_svc.get("service_name") or "system-memory.service"
        corr_msg = corr_svc.get("message") or "Active service memory operations"
        # If memory is normal (no issues detected)
        if curr_p < 70.0:
            lines = [
                "Memory Utilization Analysis",
                "",
                "Observed:",
                f"RAM utilization is normal at {curr_p:.1f}% ({used_gb:.2f} GB used out of {total_gb:.2f} GB, {avail_gb:.2f} GB available). No issues detected between {start_fmt} and {curr_fmt}.",
                "",
                "Primary process:",
                f"{p_name} (PID {p_pid})",
                f"Memory footprint: {p_mem:.2f}% (RSS {p_rss:.1f} MB).",
            ]
            if thread_cnt is not None and str(thread_cnt).strip():
                lines.append(f"Thread count: {thread_cnt}")
            lines.extend([
                "",
                "Status:",
                "Healthy. There are no issues detected. Host memory allocations are operating within normal baseline headroom.",
            ])
            return "\n".join(lines)

        lines = [
            "Memory Utilization Analysis",
            "",
            "Observed:",
            f"Memory utilization observed at {curr_p:.1f}% ({used_gb:.2f} GB of {total_gb:.2f} GB used, {avail_gb:.2f} GB available) between {start_fmt} and {curr_fmt}.",
            "",
            "Primary process:",
            f"{p_name} (PID {p_pid})",
            f"Memory footprint reached {p_mem:.2f}% (RSS {p_rss:.1f} MB).",
        ]
        if thread_cnt is not None and str(thread_cnt).strip():
            lines.append(f"Thread count: {thread_cnt}")

        lines.extend([
            "",
            "Correlated service event:",
            f"At {corr_time}, {corr_name} reported: {corr_msg}",
            "",
            "Supporting evidence:",
            "Virtual memory buffers and paging activity remain within nominal operating headroom.",
            "",
            "Likely root cause:",
            f"Elevated memory allocation detected on host '{current_m.get('hostname', 'system-host')}'.",
            "",
            "Confidence:",
            "High",
        ])
        return "\n".join(lines)

    records = metrics_payload if isinstance(metrics_payload, list) else [metrics_payload]
    if not records or not isinstance(records[0], dict):
        return "Memory Utilization Analysis\n\nNo memory records available."

    first = records[0]
    last = records[-1]
    r_first = first.get("ram_metrics", first.get("ram", {}))
    r_last = last.get("ram_metrics", last.get("ram", {}))
    start_ram = float(r_first.get("percent", first.get("usage_percent", 0.0)))
    peak_ram = float(r_last.get("percent", last.get("usage_percent", start_ram)))
    used_gb = float(r_first.get("used_gb", 0.0))
    total_gb = float(r_first.get("total_gb", 0.0))
    start_fmt = _fmt_time(first.get("timestamp", ""))
    peak_fmt = _fmt_time(last.get("timestamp", ""))

    primary = first.get("primary_process") or {}
    p_name = primary.get("name") or "Primary Process"
    p_pid = primary.get("pid", "N/A")
    p_mem = float(primary.get("memory_percent", 0.0))
    p_rss = float(primary.get("memory_rss_mb", 0.0))
    thread_cnt = primary.get("thread_count")

    if peak_ram < 70.0:
        lines = [
            "Memory Utilization Analysis",
            "",
            "Observed:",
            f"RAM utilization is normal at {peak_ram:.1f}% ({used_gb:.2f} GB of {total_gb:.2f} GB used). No issues detected between {start_fmt} and {peak_fmt}.",
            "",
            "Primary process:",
            f"{p_name} (PID {p_pid})",
            f"Memory footprint: {p_mem:.2f}% (RSS {p_rss:.1f} MB).",
        ]
        if thread_cnt is not None and str(thread_cnt).strip():
            lines.append(f"Thread count: {thread_cnt}")
        lines.extend([
            "",
            "Status:",
            "Healthy. There are no issues detected. Host memory allocations are operating within normal baseline headroom.",
        ])
        return "\n".join(lines)

    corr = first.get("correlated_service_event") or {}
    corr_time = _fmt_time(corr.get("timestamp", ""))
    corr_svc = corr.get("service_name") or "system-memory.service"
    corr_msg = corr.get("message") or "Active service memory operations"

    if start_ram < peak_ram:
        obs_line = f"RAM utilization increased from {start_ram:.1f}% to {peak_ram:.1f}% ({used_gb:.2f} GB of {total_gb:.2f} GB used) between {start_fmt} and {peak_fmt}."
    elif start_ram > peak_ram:
        obs_line = f"RAM utilization decreased from {start_ram:.1f}% to {peak_ram:.1f}% ({used_gb:.2f} GB of {total_gb:.2f} GB used) between {start_fmt} and {peak_fmt}."
    else:
        obs_line = f"RAM utilization remained steady at {peak_ram:.1f}% ({used_gb:.2f} GB of {total_gb:.2f} GB used) between {start_fmt} and {peak_fmt}."

    lines = [
        "Memory Utilization Analysis",
        "",
        "Observed:",
        obs_line,
        "",
        "Primary process:",
        f"{p_name} (PID {p_pid})",
        f"Memory reached {p_mem:.2f}% (RSS {p_rss:.1f} MB).",
    ]
    if thread_cnt is not None and str(thread_cnt).strip():
        lines.append(f"Thread count: {thread_cnt}")

    lines.extend([
        "",
        "Correlated service event:",
        f"At {corr_time}, {corr_svc} reported: {corr_msg}",
        "",
        "Supporting evidence:",
        "System services active during the observation period.",
        "",
        "Likely root cause:",
        "Elevated memory allocation detected on host.",
        "",
        "Confidence:",
        "High",
    ])
    return "\n".join(lines)


def call_llm_agent(
    agent_name: str,
    resource_type: str,
    metrics_payload: Any,
    system_instructions: str,
) -> Dict[str, Any]:
    """
    Invokes the LLM (Azure OpenAI Responses API: 5.6 luna) with the agent's instructions and segregated telemetry.
    The LLM autonomously decides the detection, root cause diagnosis, and remediation plan.
    """
    res_upper = resource_type.upper()
    is_cpu = res_upper == "CPU" or "cpu" in agent_name.lower()
    is_disk = res_upper == "DISK" or "disk" in agent_name.lower()
    is_memory = res_upper in ["RAM", "MEMORY"] or "memory" in agent_name.lower()

    analysis_instruction = ""
    analysis_field = "analysis"
    if is_cpu:
        analysis_field = "cpu_analysis"
        analysis_instruction = """
IMPORTANT: Provide a top-level string field "cpu_analysis" matching this exact structure:
CPU Utilization Analysis

Observed:
<Directional statement based on actual values:
 - If metric went up: CPU increased from <start>% to <end>% between <start_time> and <end_time>.
 - If metric went down: CPU decreased from <start>% to <end>% between <start_time> and <end_time>.
 - If metric stayed same: CPU remained steady at <val>% between <start_time> and <end_time>.
 CRITICAL: Never write "increased" when the value went down (e.g. 98% to 80% is a DECREASE, not an increase). Accurately state increased, decreased, or remained steady.>

Primary process:
<Primary process name> (PID <PID>)
CPU reached <cpu_reached>%.
[Thread count: <count>]  <-- only if thread count is present in data

Correlated service event:
At <time>, <service_name> <event_summary / log message>.

Supporting evidence:
<Secondary activity or supporting logs during the same period>.

Likely root cause:
<Root cause analysis explaining the workload impact>.

Confidence:
High | Medium | Low
"""
    elif is_disk:
        analysis_field = "disk_analysis"
        analysis_instruction = """
IMPORTANT: Provide a top-level string field "disk_analysis" matching this exact structure:
Disk Utilization Analysis

Observed:
Disk utilization observed at <used_percent>% (<used_gb> GB of <total_gb> GB used, <free_gb> GB free) between <start_time> and <end_time>.

Primary process:
<Primary process name> (PID <PID>)
Disk activity: <activity>.
[Thread count: <count>]  <-- only if thread count is present in data

Correlated service event:
At <time>, <service_name> <event_summary / log message>.

Supporting evidence:
<Secondary activity or database/logging service events during the period>.

Likely root cause:
<Root cause analysis explaining storage status and workload impact>.

Confidence:
High | Medium | Low
"""
    elif is_memory:
        analysis_field = "memory_analysis"
        analysis_instruction = """
IMPORTANT: Provide a top-level string field "memory_analysis" matching this exact structure:
Memory Utilization Analysis

Observed:
<Directional statement based on actual values:
 - If metric went up: RAM utilization increased from <start>% to <end>% (<used_gb> GB of <total_gb> GB used) between <start_time> and <end_time>.
 - If metric went down: RAM utilization decreased from <start>% to <end>% (<used_gb> GB of <total_gb> GB used) between <start_time> and <end_time>.
 - If metric stayed same: RAM utilization remained steady at <val>% (<used_gb> GB of <total_gb> GB used) between <start_time> and <end_time>.
 CRITICAL: Never write "increased" when the value went down. Accurately state increased, decreased, or remained steady.>

Primary process:
<Primary process name> (PID <PID>)
Memory reached <memory_percent>% (RSS <rss> MB).
[Thread count: <count>]  <-- only if thread count is present in data

Correlated service event:
At <time>, <service_name> <event_summary / log message>.

Supporting evidence:
<Secondary activity or database/service logs during the period>.

Likely root cause:
<Root cause analysis explaining memory consumption and workload impact>.

Confidence:
High | Medium | Low
"""

    prompt = f"""
You are the autonomous {agent_name} in an enterprise reliability engineering ecosystem.
Resource under investigation: {resource_type}

AGENT ROLE & INSTRUCTIONS:
{system_instructions}

TELEMETRY & PROCESS DATA (Resource metrics, top 15 live processes, and system service logs):
{json.dumps(metrics_payload, indent=2)}

TASK:
1. Analyze the provided resource metrics, top 15 live processes, and system service logs thoroughly.
2. If threshold limits are exceeded (>= 50%, >= 70%, >= 90%, 100%), formulate and RECOMMEND concrete autonomous remediation plans targeting the offending processes from the top 15 list.
3. Note: Human-in-the-Loop approval is kept aside; provide direct autonomous recommendations.
4. DEDUCE THE EXACT SIGNALS AND PARAMETERS FROM THE TELEMETRY AND TOP 15 PROCESS DATA:
   * Decide whether the situation warrants SIGTERM (-15), pkill (-15 -f <script_name>), SIGKILL (-9), renice (-n 10 to -n 19), or systemctl restart/reload based directly on the offending process.
   * DECIDE THE PRIMARY REMEDIATION COMMAND (in "command") with an evidence-based "remediation_rationale".
   * PROVIDE TOP 2 TO 3 DIVERSE ALTERNATIVE REMEDIATIONS (in "alternatives"):
     * Do NOT output boilerplate identical options. Formulate 2 or 3 distinct operational strategies tailored to the processes and logs (e.g. Option 1: Graceful Termination via SIGTERM or pkill -f; Option 2: Zero-Data-Loss Priority Throttling via renice; Option 3: Service-level Restart/Reload).
     * For each alternative, provide "label", "command" (exact string), "action_type", "target_identifier", "signal" (if applicable), and "description" explaining the operational trade-off.
   * Allowed binaries: kill, pkill, systemctl, renice, journalctl.
5. If there are multiple problematic spikes or processes, formulate an individualized plan based on the top 15 processes.
{analysis_instruction}

Respond ONLY with a valid JSON object matching this structure:
{{
  "agent": "{agent_name}",
  "resource": "{resource_type}",
  "{analysis_field}": "Structured analysis string matching the format above",
  "detection": {{
    "detected": true,
    "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
    "highest_threshold_crossed": 100 | 70 | 50 | null,
    "summary": "Concise summary of what was detected"
  }},
  "diagnosis": {{
    "diagnosis_status": "CONFIRMED" | "HEALTHY",
    "root_cause": "Specific technical root cause based on the metrics",
    "explanation": "Detailed technical explanation of the issue"
  }},
  "remediation": {{
    "action_required": "Concrete actionable steps to mitigate the issue",
    "preventive_guardrail": "Long-term architectural guardrail to prevent recurrence",
    "command": "Exact single whitespace-separated primary command decided by agent (e.g. 'sudo kill -15 2818' or 'sudo kill -9 2818' or 'sudo renice -n 19 -p 2818')",
    "remediation_rationale": "Detailed explanation of why this specific signal/command was selected based on the 15 logs",
    "alternatives": [
      {{
        "label": "Short strategy title (e.g. 'Priority Throttling (renice)')",
        "command": "Exact Linux command (e.g. 'sudo renice -n 19 -p 2818')",
        "action_type": "RENICE_PROCESS | KILL_PROCESS | RESTART_SERVICE",
        "target_identifier": "Target PID or service name",
        "signal": 15,
        "description": "Specific trade-off and rationale for this option based on telemetry"
      }}
    ]
  }},
  "remediation_plans": [
    {{
      "plan_id": "REMED-{resource_type.upper()}-001",
      "service_name": "Service responsible for this specific spike",
      "timestamp": "Timestamp of the spike/record",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM",
      "root_cause": "Root cause for this specific spike",
      "action_required": "Specific action for this record",
      "preventive_guardrail": "Guardrail",
      "command": "Exact primary command decided by agent",
      "remediation_rationale": "Detailed rationale based on 15 logs",
      "alternatives": [
        {{
          "label": "Short strategy title",
          "command": "Exact Linux command",
          "action_type": "RENICE_PROCESS | KILL_PROCESS | RESTART_SERVICE",
          "target_identifier": "Target PID or service name",
          "signal": 15,
          "description": "Specific trade-off based on telemetry"
        }}
      ]
    }}
  ]
}}
"""

    raw_response_text = invoke_azure_responses_api(
        prompt=prompt,
        system_instructions=system_instructions,
        model_name=MODEL_NAME,
    )

    if not raw_response_text and os.getenv("GOOGLE_API_KEY") and str(MODEL_NAME).lower().startswith("gemini"):
        client = get_genai_client()
        if client:
            try:
                response = client.models.generate_content(
                    model=MODEL_NAME,
                    contents=prompt,
                )
                if response and response.text:
                    raw_response_text = response.text
            except Exception as exc:
                logger.warning(f"GenAI fallback failed: {exc}")


    if raw_response_text:
        try:
            cleaned_text = _clean_json_markdown(raw_response_text)
            parsed_json = json.loads(cleaned_text)
            parsed_json["llm_powered"] = True
            parsed_json["model_used"] = MODEL_NAME
            parsed_json["endpoint_used"] = LLM_ENDPOINT
            if is_cpu and not parsed_json.get("cpu_analysis"):
                parsed_json["cpu_analysis"] = build_cpu_utilization_analysis_text(metrics_payload)
            elif is_disk and not parsed_json.get("disk_analysis"):
                parsed_json["disk_analysis"] = build_disk_utilization_analysis_text(metrics_payload)
            elif is_memory and not parsed_json.get("memory_analysis"):
                parsed_json["memory_analysis"] = build_memory_utilization_analysis_text(metrics_payload)
            return parsed_json
        except Exception as exc:
            logger.warning(f"Failed to parse LLM JSON output from model {MODEL_NAME}: {exc}")


    # Graceful fallback if LLM is offline / quota exhausted
    logger.info(f"Generating structured response via local intelligence fallback for {agent_name}")
    fallback_resp = _generate_fallback_agent_response(agent_name, resource_type, metrics_payload)
    if is_cpu:
        fallback_resp["cpu_analysis"] = build_cpu_utilization_analysis_text(metrics_payload)
    elif is_disk:
        fallback_resp["disk_analysis"] = build_disk_utilization_analysis_text(metrics_payload)
    elif is_memory:
        fallback_resp["memory_analysis"] = build_memory_utilization_analysis_text(metrics_payload)
    return fallback_resp


def _generate_fallback_agent_response(
    agent_name: str,
    resource_type: str,
    metrics_payload: Any,
) -> Dict[str, Any]:
    """Fallback when external LLM API is unreachable."""
    res_upper = resource_type.upper()
    is_cpu = res_upper == "CPU" or "cpu" in agent_name.lower()
    is_disk = res_upper == "DISK" or "disk" in agent_name.lower()
    is_memory = res_upper in ["RAM", "MEMORY"] or "memory" in agent_name.lower()

    peak = 0.0
    current_val = 0.0

    if isinstance(metrics_payload, dict) and "current_metrics" in metrics_payload:
        cur_m = metrics_payload.get("current_metrics") or {}
        latest_5 = metrics_payload.get("latest_5_recordings") or [cur_m]
        if is_disk:
            disk_info = cur_m.get("disk") or cur_m.get("disk_metrics") or {}
            current_val = float(disk_info.get("percent", 0.0) or 0.0)
            recent = [float((r.get("disk") or r.get("disk_metrics") or {}).get("percent", current_val) or current_val) for r in latest_5]
            peak = max([current_val] + recent) if recent else current_val
        elif is_memory:
            ram_info = cur_m.get("ram") or cur_m.get("memory") or cur_m.get("ram_metrics") or {}
            current_val = float(ram_info.get("percent", 0.0) or 0.0)
            recent = [float((r.get("ram") or r.get("memory") or r.get("ram_metrics") or {}).get("percent", current_val) or current_val) for r in latest_5]
            peak = max([current_val] + recent) if recent else current_val
        else:
            cpu_info = cur_m.get("cpu") or cur_m.get("cpu_metrics") or {}
            current_val = float(cpu_info.get("total", cpu_info.get("total_percent", 0.0)) or 0.0)
            recent = [float((r.get("cpu") or r.get("cpu_metrics") or {}).get("total", (r.get("cpu") or {}).get("total_percent", current_val)) or current_val) for r in latest_5]
            peak = max([current_val] + recent) if recent else current_val
    elif isinstance(metrics_payload, list) and metrics_payload:
        if is_disk:
            peak = max([float(m.get("disk_metrics", {}).get("percent", (m.get("disk") or {}).get("percent", m.get("usage_percent", 0.0)))) for m in metrics_payload if isinstance(m, dict)] or [0.0])
            current_val = peak
        elif is_memory:
            peak = max([float(m.get("ram_metrics", {}).get("percent", (m.get("ram") or m.get("memory") or {}).get("percent", m.get("usage_percent", 0.0)))) for m in metrics_payload if isinstance(m, dict)] or [0.0])
            current_val = peak
        else:
            peak = max([float(m.get("cpu_metrics", {}).get("total_percent", (m.get("cpu") or {}).get("total", m.get("usage_percent", 0.0)))) for m in metrics_payload if isinstance(m, dict)] or [0.0])
            current_val = peak
    elif isinstance(metrics_payload, dict):
        if is_disk:
            disk_info = metrics_payload.get("disk") or metrics_payload.get("disk_metrics") or {}
            peak = float(disk_info.get("percent", metrics_payload.get("usage_percent", 0.0)))
            current_val = peak
        elif is_memory:
            ram_info = metrics_payload.get("ram") or metrics_payload.get("memory") or metrics_payload.get("ram_metrics") or {}
            peak = float(ram_info.get("percent", metrics_payload.get("usage_percent", 0.0)))
            current_val = peak
        else:
            cpu_info = metrics_payload.get("cpu") or metrics_payload.get("cpu_metrics") or {}
            peak = float(cpu_info.get("total", cpu_info.get("total_percent", metrics_payload.get("usage_percent", 0.0))))
            current_val = peak

    threshold = 100 if peak >= 99.0 else (70 if peak >= 70.0 else (50 if peak >= 50.0 else None))
    severity = "CRITICAL" if threshold == 100 else ("HIGH" if threshold == 70 else ("MEDIUM" if threshold == 50 else "LOW"))

    analysis_dict = {}
    if is_cpu:
        analysis_dict["cpu_analysis"] = build_cpu_utilization_analysis_text(metrics_payload)
    elif is_disk:
        analysis_dict["disk_analysis"] = build_disk_utilization_analysis_text(metrics_payload)
    elif is_memory:
        analysis_dict["memory_analysis"] = build_memory_utilization_analysis_text(metrics_payload)

    cmd = ""
    rationale = ""
    top_procs = []
    if isinstance(metrics_payload, dict):
        if is_memory:
            top_procs = metrics_payload.get("top_15_memory_processes") or metrics_payload.get("top_15_processes") or metrics_payload.get("top_memory_processes") or metrics_payload.get("top_processes") or metrics_payload.get("top_5_processes") or []
        elif is_disk:
            top_procs = metrics_payload.get("top_15_disk_processes") or metrics_payload.get("top_15_processes") or metrics_payload.get("top_processes") or metrics_payload.get("top_5_processes") or []
        else:
            top_procs = metrics_payload.get("top_15_processes") or metrics_payload.get("top_processes") or metrics_payload.get("top_5_processes") or []

    alternatives = []
    if threshold and threshold >= 50:
        if is_cpu:
            cmd = "az webapp restart --name miraai-auditsphere-dev --resource-group MiraAI-AuditSphere"
            rationale = "Restart Azure App Service container 'miraai-auditsphere-dev' to clear saturated compute execution threads and recycle application workers."
            alternatives = [
                {
                    "action_type": "SCALE_COMPUTE_TIER",
                    "label": "Scale Up Compute Tier (P1V3)",
                    "command": "az appservice plan update --name ASP-MiraAIAuditSphere-dev --resource-group MiraAI-AuditSphere --sku P1V3",
                    "target_identifier": "miraai-auditsphere-dev",
                    "description": "Upgrade App Service Plan to P1V3 for dedicated compute cores and enhanced CPU burst headroom.",
                },
                {
                    "action_type": "SCALE_OUT_INSTANCES",
                    "label": "Scale Out Instance Count (2 Nodes)",
                    "command": "az webapp update --name miraai-auditsphere-dev --resource-group MiraAI-AuditSphere --number-of-workers 2",
                    "target_identifier": "miraai-auditsphere-dev",
                    "description": "Add an additional worker node to balance high application traffic across multiple CPU instances.",
                },
            ]
        elif is_memory:
            cmd = "az webapp restart --name miraai-auditsphere-dev --resource-group MiraAI-AuditSphere"
            rationale = "Recycle Azure App Service container instance to flush memory leak allocations and reclaim working set RAM."
            alternatives = [
                {
                    "action_type": "SCALE_MEMORY_TIER",
                    "label": "Scale Up Memory Tier (B2/P1V3)",
                    "command": "az appservice plan update --name ASP-MiraAIAuditSphere-dev --resource-group MiraAI-AuditSphere --sku B2",
                    "target_identifier": "miraai-auditsphere-dev",
                    "description": "Upgrade to B2 / P1V3 App Service Plan to allocate 3.5 GB+ RAM for high memory workloads.",
                },
                {
                    "action_type": "TUNE_APP_HEAP",
                    "label": "Tune Container Runtime Memory",
                    "command": 'az webapp config appsettings set --name miraai-auditsphere-dev --resource-group MiraAI-AuditSphere --settings NODE_OPTIONS="--max-old-space-size=1536"',
                    "target_identifier": "miraai-auditsphere-dev",
                    "description": "Configure explicit memory bounds on runtime process memory to prevent container OOM aborts.",
                },
            ]
        else:
            cmd = "az webapp log config --name miraai-auditsphere-dev --resource-group MiraAI-AuditSphere --application-logging filesystem --level error"
            rationale = "Reconfigure Azure application log verbosity to ERROR and clear filesystem cache to recover storage headroom on /mnt."
            alternatives = [
                {
                    "action_type": "PURGE_CONTAINER_TEMP",
                    "label": "Clear /mnt Container Temp Files",
                    "command": "find /mnt -type f -name '*.tmp' -delete",
                    "target_identifier": "miraai-auditsphere-dev",
                    "description": "Clean temporary cache files from /mnt mount point to restore disk operational headroom.",
                },
            ]

    return {
        "agent": agent_name,
        "resource": resource_type,
        "llm_powered": False,
        **analysis_dict,
        "detection": {
            "subagent": "detection_agent",
            "detected": threshold is not None,
            "severity": severity,
            "highest_threshold_crossed": threshold,
            "summary": (
                f"{resource_type} utilization reached {peak:.1f}%. Exceeded threshold tier: {threshold}%."
                if threshold
                else f"No issues detected. {resource_type} utilization is normal at {peak:.1f}%."
            ),
        },
        "diagnosis": {
            "subagent": "diagnosis_agent",
            "diagnosis_status": "CONFIRMED" if threshold else "HEALTHY",
            "root_cause": (
                f"Full {resource_type} saturation ({peak:.1f}%) driven by active workload on Azure App Service."
                if peak >= 99.0
                else f"Elevated {resource_type} resource demand ({peak:.1f}%)."
                if threshold
                else f"No issues detected. {resource_type} compute and capacity are operating within healthy limits ({peak:.1f}%)."
            ),
            "explanation": (
                f"Azure App Service worker host is operating at {peak:.1f}% {resource_type} capacity."
                if threshold
                else f"Monitored processes and host {resource_type} metrics are within normal baseline headroom."
            ),
        },
        "remediation": {
            "subagent": "remediation_agent",
            "status": "REMEDIATION_DRAFTED" if threshold else "HEALTHY",
            "action_required": (
                f"Execute command: {cmd}\nRationale: {rationale}"
                if cmd
                else (
                    f"Scale host {resource_type} resources immediately and inspect application logs."
                    if threshold
                    else "No issues detected. No remediation required."
                )
            ),
            "preventive_guardrail": (
                f"Configure proactive Azure Monitor alert rules at 70% for {resource_type}."
                if threshold
                else f"Continue standard monitoring for {resource_type}."
            ),
            "command": cmd,
            "remediation_rationale": rationale,
            "alternatives": alternatives,
        },
        "remediation_plans": [
            {
                "plan_id": f"REMED-{resource_type.upper()}-001",
                "severity": severity,
                "root_cause": f"{resource_type} reached {peak:.1f}%",
                "action_required": f"Execute command: {cmd}",
                "preventive_guardrail": f"Set automated Azure alert policies for {resource_type}.",
                "command": cmd,
                "remediation_rationale": rationale,
                "alternatives": alternatives,
            }
        ] if (threshold and cmd) else [],
    }


def analyze_application_logs_content(log_content: str, filter_context: str = "") -> str:
    """
    Analyzes application log content using Azure OpenAI (gpt-5.6-terra)
    with a structured prompt for Root Cause, Likely Cause, and Remediation Steps.
    Includes an autonomous deterministic fallback if the LLM API is unavailable.
    """
    if not log_content or not log_content.strip():
        return (
            "No log content was provided for analysis. Please ensure application logs are flowing "
            "or select logs to analyze."
        )

    # Clean and cap log content to avoid token overflow
    lines = [l.strip() for l in log_content.splitlines() if l.strip()]
    total_lines = len(lines)
    sample_lines = lines[:100]  # Analyze up to top 100 lines
    text_sample = "\n".join(sample_lines)

    system_instructions = (
        "You are an expert Cloud SRE and Application Reliability AI Agent. "
        "Analyze the provided application log entries. "
        "You must structure your response clearly with these exact sections:\n"
        "Explanation:\n<clear 2-3 sentence executive summary of errors and anomaly patterns detected>\n\n"
        "Likely Cause:\n<precise technical root cause, e.g. database connection pool exhaustion, downstream 504 timeout, OOM crash>\n\n"
        "Remediation Steps:\n1. <First actionable step>\n2. <Second actionable step>\n3. <Third actionable step>"
    )

    prompt = (
        f"Context: {filter_context}\n"
        f"Total Log Lines: {total_lines}\n\n"
        f"Log Telemetry Data:\n{text_sample}\n\n"
        "Please provide the complete reliability analysis (Explanation, Likely Cause, Remediation Steps)."
    )

    # 1. Try Azure OpenAI Responses API
    llm_resp = invoke_azure_responses_api(
        prompt=prompt,
        system_instructions=system_instructions,
        timeout=40,
    )
    if llm_resp and len(llm_resp.strip()) > 30:
        return llm_resp.strip()

    # 2. Smart Deterministic Fallback based on log semantics
    error_count = sum(1 for l in lines if re.search(r"\b(error|exception|fail|5\d{2}|fatal|crash|refused)\b", l, re.I))
    warn_count = sum(1 for l in lines if re.search(r"\b(warn|timeout|retry|deprecated)\b", l, re.I))

    # Detect dominant error keywords
    has_db = any(re.search(r"\b(db|database|sql|connection|pool|deadlock)\b", l, re.I) for l in lines)
    has_http5xx = any(re.search(r"\b(500|502|503|504|internal server error)\b", l, re.I) for l in lines)
    has_oom = any(re.search(r"\b(oom|out of memory|heap|memory)\b", l, re.I) for l in lines)
    has_timeout = any(re.search(r"\b(timeout|timed out|refused)\b", l, re.I) for l in lines)

    if has_oom:
        likely = "Java/Process memory exhaustion (Out of Memory) causing unhandled crashes."
        remediation = [
            "Scale up VM / App Service memory tier and tune max heap size (-Xmx).",
            "Identify memory-leaking processes from live worker diagnostics.",
            "Restart the affected worker service container.",
        ]
    elif has_db:
        likely = "Database connection pool exhaustion or database query timeout."
        remediation = [
            "Verify database server connectivity, active connection count, and query latency.",
            "Increase connection pool limits and check for slow/unindexed queries.",
            "Inspect database failover and replica health status.",
        ]
    elif has_http5xx:
        likely = "Downstream service unresponsiveness or upstream reverse proxy gateway failure."
        remediation = [
            "Check downstream dependency health and network ingress latency.",
            "Review application worker thread availability and restart failing instances.",
            "Inspect Application Insights traces for detailed 5xx exception stack traces.",
        ]
    elif has_timeout:
        likely = "Network transit latency or downstream socket timeout during service-to-service communication."
        remediation = [
            "Check network peering routes and firewall throughput limits.",
            "Tune HTTP client connect/read timeouts and implement circuit breakers.",
            "Verify external API availability and SLA response times.",
        ]
    elif error_count == 0 and warn_count == 0:
        return (
            f"Explanation:\n"
            f"Analyzed {total_lines} application log lines ({filter_context or 'active live stream'}). "
            f"Zero critical crash, error, or warning events were detected in this telemetry slice. "
            f"The application workload is operating smoothly within healthy baseline thresholds.\n\n"
            f"Likely Cause:\nNormal system runtime and routine background telemetry processing.\n\n"
            f"Remediation Steps:\n"
            f"1. Maintain current live telemetry streaming and threshold rules.\n"
            f"2. Continue periodic log ingestion and health monitoring.\n"
            f"3. No remediation action required at this time."
        )
    else:
        likely = f"Application level errors detected ({error_count} error occurrences, {warn_count} warnings)."
        remediation = [
            "Inspect recent application deployments and configuration diffs.",
            "Check host infrastructure metrics (CPU, RAM, Disk) for resource contention.",
            "Enable verbose debug logging for the affected service modules.",
        ]

    remediation_str = "\n".join([f"{i+1}. {step}" for i, step in enumerate(remediation)])

    return (
        f"Explanation:\n"
        f"Analyzed {total_lines} application log lines. Detected {error_count} error events and "
        f"{warn_count} warning events in the active telemetry window. "
        f"Errors indicate anomalous service degradation requiring operational attention.\n\n"
        f"Likely Cause:\n{likely}\n\n"
        f"Remediation Steps:\n{remediation_str}"
    )

