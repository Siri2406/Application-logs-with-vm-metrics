import json
import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query

from tools.system_agent_pipeline import process_system_memory_metrics
from tools.metrics_fetcher import CURRENT_METRICS_API_URL, HISTORY_API_URL, load_configured_metrics, store_metrics_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["Memory / RAM Agent (Direct 3-Subagent Pipeline)"])

DEFAULT_METRICS_URL = CURRENT_METRICS_API_URL


@router.api_route("/analyze", methods=["GET", "POST"])
def analyze_memory_latest_history():
    """
    Direct Memory Agent Endpoint:
    1. Ingests live telemetry directly from remote VM endpoints (/api/metrics, /api/history, /api/processes, /api/service-logs).
    2. Runs LLM-powered Detection -> Diagnosis -> Remediation on live Memory telemetry.
    3. Evaluates highest crossed operational threshold (70%, 80%, 90%).
    4. Dispatches alert email if threshold exceeded.
    5. Returns detection, root cause, remediation, and individual remediation plans.
    """
    try:
        logger.info(f"📥 [Memory Agent] /api/memory/analyze request received! Fetching live VM telemetry from {CURRENT_METRICS_API_URL}...")
        result = process_system_memory_metrics(source=None)
        result["source_url"] = CURRENT_METRICS_API_URL
        result["source_file"] = None
        logger.info(f"📤 [Memory Agent] Completed! Host: {result.get('hostname')} | Current Memory: {result.get('current_usage_percent')}% | Records: {result.get('total_records_analyzed')}")
        return result
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.error(f"Memory Agent error: {exc}")
        raise HTTPException(
            status_code=500,
            detail=f"Memory Agent failed to process telemetry: {str(exc)}",
        )


@router.get("/history")
async def analyze_memory_history(force_fetch: bool = Query(False)):
    """Live telemetry history analysis endpoint for Memory."""
    result = process_system_memory_metrics(source=None)
    result["source_url"] = CURRENT_METRICS_API_URL
    result["source_file"] = None
    return result
