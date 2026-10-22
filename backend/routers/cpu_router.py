import json
import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query

from tools.system_agent_pipeline import process_system_cpu_metrics
from tools.metrics_fetcher import CURRENT_METRICS_API_URL, HISTORY_API_URL, load_configured_metrics, store_metrics_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cpu", tags=["CPU Agent (Direct 3-Subagent Pipeline)"])

DEFAULT_METRICS_URL = CURRENT_METRICS_API_URL


@router.api_route("/analyze", methods=["GET", "POST"])
def analyze_cpu_latest_history():
    """
    Direct CPU Agent Endpoint:
    1. Ingests live telemetry directly from remote VM endpoints (/api/metrics, /api/history, /api/processes, /api/service-logs).
    2. Runs LLM-powered Detection -> Diagnosis -> Remediation on live CPU telemetry.
    3. Evaluates highest crossed operational threshold (50%, 70%, 100%).
    4. Dispatches alert email if threshold exceeded.
    5. Returns detection, root cause, remediation, and individual remediation plans.
    """
    try:
        logger.info(f"📥 [CPU Agent] /api/cpu/analyze request received! Fetching live VM telemetry from {CURRENT_METRICS_API_URL}...")
        result = process_system_cpu_metrics(source=None)
        result["source_url"] = CURRENT_METRICS_API_URL
        result["source_file"] = None
        logger.info(f"📤 [CPU Agent] Completed! Host: {result.get('hostname')} | Current CPU: {result.get('current_usage_percent')}% | Records: {result.get('total_records_analyzed')}")
        return result
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error(f"CPU Agent error: {exc}")
        raise HTTPException(
            status_code=500,
            detail=f"CPU Agent failed to process telemetry: {str(exc)}",
        )


@router.get("/history")
async def analyze_cpu_history(force_fetch: bool = Query(False)):
    """Live telemetry history analysis endpoint for CPU."""
    result = process_system_cpu_metrics(source=None)
    result["source_url"] = CURRENT_METRICS_API_URL
    result["source_file"] = None
    return result
