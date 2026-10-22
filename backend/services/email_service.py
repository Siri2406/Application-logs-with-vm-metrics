import json
import logging
import os
import shutil
import smtplib
import ssl
import subprocess
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_PATH)

logger = logging.getLogger(__name__)

DEFAULT_ALERT_EMAIL = os.getenv("DEFAULT_ALERT_EMAIL", "")
EMAIL_ALERTS_LOG = Path(__file__).resolve().parent.parent / "logs" / "email_alerts.log"
NODEMAILER_SCRIPT = Path(__file__).resolve().parent / "nodemailer_service.js"


def get_highest_crossed_threshold(
    usage_percent: float,
    per_core: Optional[List[float]] = None,
    resource_name: str = "CPU",
) -> Optional[int]:
    """
    Identifies the highest crossed threshold tier from configured rules.
    If database lookup fails, falls back to default tiers (70%, 90%, 100%).
    """
    try:
        from services.alert_db import get_highest_matching_threshold
        matched = get_highest_matching_threshold(resource_name, usage_percent, per_core)
        if matched is not None:
            return matched
    except Exception as exc:
        logger.warning(f"Failed dynamic threshold match, falling back to static tiers: {exc}")

    # Fallback to standard 70/90/100 logic
    is_saturated_core = per_core and any(c >= 99.0 for c in per_core)
    if usage_percent >= 99.0 or is_saturated_core:
        return 100
    elif usage_percent >= 90.0:
        return 90
    elif usage_percent >= 70.0:
        return 70
    return None


def evaluate_history_highest_threshold(
    records: List[Dict[str, Any]],
    resource_key: str = "usage_percent",
) -> Optional[int]:
    """
    Evaluates all historical records and determines the single highest threshold crossed.
    Suppose in history we have 70% and 90% threshold exceeded -> returns 90.
    If 100% is exceeded -> returns 100.
    """
    highest = None
    for r in records:
        val = float(r.get(resource_key, 0.0))
        per_core = r.get("per_core")
        th = get_highest_crossed_threshold(val, per_core)
        if th is not None:
            if highest is None or th > highest:
                highest = th
    return highest


def check_resource_thresholds(
    usage_percent: float,
    resource_name: str = "CPU",
    per_core: Optional[List[float]] = None,
) -> List[int]:
    """
    Backward-compatible helper returning crossed tiers.
    """
    highest = get_highest_crossed_threshold(usage_percent, per_core)
    return [highest] if highest is not None else []


def _send_via_smtp(
    recipient: str,
    subject: str,
    html_content: str,
    text_content: str,
) -> Optional[Dict[str, Any]]:
    """
    Sends email directly using Python standard smtplib with TLS/SSL.
    Reads current credentials directly from the environment.
    """
    load_dotenv(ENV_PATH, override=True)
    smtp_enabled = (os.getenv("SMTP_ENABLED") or "false").lower() == "true"
    if not smtp_enabled:
        return None

    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = (os.getenv("SMTP_USER") or "").strip()
    smtp_pass = (os.getenv("SMTP_PASS") or "").replace(" ", "").strip()
    smtp_from = (os.getenv("SMTP_FROM") or smtp_user or "system-monitor@agentecosystem.local").strip()

    if not (smtp_user and smtp_pass and recipient):
        logger.warning("SMTP missing required credentials (SMTP_USER, SMTP_PASS, or recipient)")
        return None

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = smtp_from
        msg["To"] = recipient

        msg.attach(MIMEText(text_content, "plain", "utf-8"))
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        if smtp_port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=15) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        else:
            context = ssl.create_default_context()
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)

        logger.info(f"Threshold email successfully dispatched via SMTP to {recipient}")
        return {
            "status": "SENT",
            "provider": "smtp",
            "action_taken": f"Email sent successfully via SMTP to {recipient}",
        }
    except Exception as exc:
        logger.error(f"Python SMTP delivery failed: {exc}")
        return None


def format_to_local_system_timestamp(ts: Any) -> str:
    """
    Converts a UTC or ISO timestamp to the system or mobile device local timestamp format.
    E.g. '2026-10-21 04:52:12 PM IST' (or local system timezone).
    """
    if not ts:
        return datetime.now().astimezone().strftime("%Y-%m-%d %I:%M:%S %p %Z")

    if isinstance(ts, datetime):
        dt = ts
    else:
        cleaned = str(ts).strip()
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(cleaned)
        except Exception:
            try:
                dt = datetime.strptime(cleaned, "%Y-%m-%d %H:%M:%S")
            except Exception:
                return str(ts)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    local_dt = dt.astimezone()
    return local_dt.strftime("%Y-%m-%d %I:%M:%S %p %Z")


def send_threshold_alert_email(
    resource_name: str,
    usage_percent: float,
    threshold: int,
    hostname: str,
    timestamp: str,
    details: Dict[str, Any],
    remediation_summary: Optional[str] = None,
    recipient_email: Optional[str] = None,
    remediation_plan: Optional[Dict[str, Any]] = None,
    remediation_plans: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Dispatches a single threshold alert email to the recipient using Python native SMTP,
    falling back to Node.js Nodemailer or local audit-logging to logs/email_alerts.log.
    """
    load_dotenv(ENV_PATH, override=True)
    recipient_email = (recipient_email or os.getenv("DEFAULT_ALERT_EMAIL") or os.getenv("SMTP_USER", "")).strip()
    subject = f"Limit crossed {threshold}% {resource_name} usage"

    local_timestamp_str = format_to_local_system_timestamp(timestamp)

    primary_plan = remediation_plan or (remediation_plans[0] if remediation_plans else None)
    if not primary_plan and isinstance(remediation_summary, dict):
        primary_plan = remediation_summary

    if primary_plan:
        primary_cmd = (primary_plan.get("command") or "").strip()
        primary_rationale = (
            primary_plan.get("remediation_rationale")
            or primary_plan.get("action_required")
            or ""
        ).strip()
        alternatives = primary_plan.get("alternatives") or []
    else:
        primary_cmd = ""
        primary_rationale = str(remediation_summary or "").strip()
        alternatives = []

    cmd_block = ""
    if primary_cmd:
        cmd_block = f"""
        <div style="background: #1e293b; color: #38bdf8; padding: 10px 14px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; font-size: 0.95em; margin-top: 8px; overflow-x: auto;">
          <span style="color: #94a3b8; user-select: none;">$ </span><strong style="color: #38bdf8;">{primary_cmd}</strong>
        </div>
        """

    alternatives_block = ""
    if alternatives:
        alt_items = []
        for idx, alt in enumerate(alternatives):
            if not isinstance(alt, dict):
                continue
            alt_label = alt.get("label") or f"Alternative Strategy {idx + 1}"
            alt_desc = alt.get("description") or ""
            alt_cmd = alt.get("command") or ""
            alt_items.append(f"""
            <div style="background: #fdfdfd; border: 1px solid #dee2e6; border-left: 3px solid #0d6efd; padding: 10px 12px; border-radius: 4px; margin-bottom: 8px;">
              <div style="font-weight: bold; color: #0d6efd; font-size: 0.95em; margin-bottom: 4px;">{alt_label}</div>
              {f'<div style="font-size: 0.9em; color: #555; margin-bottom: 6px;">{alt_desc}</div>' if alt_desc else ''}
              {f'<div style="background: #1e293b; color: #38bdf8; padding: 6px 10px; border-radius: 3px; font-family: monospace; font-size: 0.9em;">$ {alt_cmd}</div>' if alt_cmd else ''}
            </div>
            """)
        if alt_items:
            alternatives_block = f"""
            <h4 style="margin: 18px 0 8px 0; color: #495057;">Alternative Remediation Strategies ({len(alt_items)} Formulated from Logs):</h4>
            {''.join(alt_items)}
            """

    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 5px;">
          <h2 style="color: #721c24; margin-top: 0;">⚠️ System Resource Alert: {subject}</h2>
          <p><strong>Host:</strong> {hostname}</p>
          <p><strong>Timestamp:</strong> {local_timestamp_str}</p>
          <p><strong>Metric:</strong> {resource_name} Utilization</p>
          <p><strong>Observed Usage:</strong> <span style="font-size: 1.2em; font-weight: bold; color: #d9534f;">{usage_percent:.1f}%</span> (Threshold: {threshold}%)</p>
        </div>
        
        <h3>Metric Details:</h3>
        <pre style="background: #f4f4f4; padding: 10px; border-radius: 4px;">{json.dumps(details, indent=2)}</pre>
        
        <h3>Recommended Remediation Action (Agent Plan):</h3>
        <div style="background: #e2f0cb; padding: 12px 15px; border-left: 4px solid #6b8e23; border-radius: 4px;">
          <p style="margin: 0 0 6px 0; font-weight: bold; color: #2e5a1c;">
            Recommended Strategy:
          </p>
          <p style="margin: 0 0 8px 0; color: #222;">
            {primary_rationale or 'Remediation plan formulated from live telemetry logs.'}
          </p>
          {cmd_block}
        </div>
        {alternatives_block}
        
        <p style="font-size: 0.85em; color: #777; margin-top: 20px;">Notification delivered via Autonomous Multi-Agent Monitoring Ecosystem.</p>
      </body>
    </html>
    """

    alt_text_lines = []
    if alternatives:
        for alt in alternatives:
            if isinstance(alt, dict):
                alt_text_lines.append(f"- {alt.get('label')}: {alt.get('command')} ({alt.get('description', '')})")
    alt_text_str = ("\nAlternatives:\n" + "\n".join(alt_text_lines)) if alt_text_lines else ""

    text_content = (
        f"Limit crossed {threshold}% {resource_name} usage on {hostname}.\n"
        f"Timestamp: {local_timestamp_str}\n"
        f"Usage: {usage_percent:.1f}%\n"
        f"Recommended Remediation: {primary_rationale}\n"
        f"{f'Command: {primary_cmd}' if primary_cmd else ''}\n"
        f"{alt_text_str}"
    )

    from services.alert_db import insert_alert

    # 1. Native Python SMTP delivery
    smtp_res = _send_via_smtp(recipient_email, subject, html_content, text_content)
    if smtp_res and smtp_res.get("status") == "SENT":
        alert_record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "recipient": recipient_email,
            "subject": subject,
            "resource": resource_name,
            "threshold": threshold,
            "usage_percent": usage_percent,
            "hostname": hostname,
            "status": "SENT",
            "provider": "smtp",
            "action_taken": f"Threshold {threshold}% alert email sent successfully via SMTP to {recipient_email}",
            "details": details,
        }
        EMAIL_ALERTS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(EMAIL_ALERTS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(alert_record) + "\n")
        try:
            insert_alert(alert_record)
        except Exception as db_err:
            logger.warning(f"Failed to record alert in SQLite DB: {db_err}")
        return alert_record

    # 2. Secondary: Node.js Nodemailer fallback (if configured)
    payload = {
        "to": recipient_email,
        "subject": subject,
        "resource": resource_name,
        "threshold": threshold,
        "usage_percent": usage_percent,
        "hostname": hostname,
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
        "html": html_content,
        "text": text_content,
    }

    node_bin = shutil.which("node")
    if node_bin and NODEMAILER_SCRIPT.exists():
        try:
            import base64
            b64_arg = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
            proc = subprocess.run(
                [node_bin, str(NODEMAILER_SCRIPT), b64_arg],
                text=True,
                capture_output=True,
                timeout=20,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                try:
                    result = json.loads(proc.stdout.strip())
                    if result.get("status") == "SENT":
                        result["resource"] = resource_name
                        result["threshold"] = threshold
                        result["usage_percent"] = usage_percent
                        result["hostname"] = hostname
                        result["details"] = details
                        try:
                            insert_alert(result)
                        except Exception as db_err:
                            logger.warning(f"Failed to record Nodemailer alert in SQLite DB: {db_err}")
                        return result
                except json.JSONDecodeError:
                    pass
        except Exception as exc:
            logger.warning(f"Nodemailer fallback execution failed: {exc}")

    # 3. Fallback: Local audit log & database
    alert_record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "recipient": recipient_email,
        "subject": subject,
        "resource": resource_name,
        "threshold": threshold,
        "usage_percent": usage_percent,
        "hostname": hostname,
        "status": "RECORDED_LOCALLY",
        "provider": "local_fallback",
        "action_taken": f"Threshold {threshold}% alert recorded locally (SMTP dispatch failed or disabled) for {recipient_email}",
        "details": details,
    }

    EMAIL_ALERTS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(EMAIL_ALERTS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(alert_record) + "\n")

    try:
        insert_alert(alert_record)
    except Exception as db_err:
        logger.warning(f"Failed to record fallback alert in SQLite DB: {db_err}")

    return alert_record


# ==============================================================================
# Application Log Alert Email Functions
# ==============================================================================

def build_email_html(issues: List[Dict[str, Any]], log_source: str = "") -> str:
    """Build a clean, readable HTML email body for critical/high severity application log issues."""
    severity_colors = {
        "CRITICAL": ("#ff4d4d", "#fff0f0"),
        "HIGH": ("#ff8c00", "#fff8f0"),
    }

    rows_html = ""
    for issue in issues:
        severity = issue.get("severity", "HIGH")
        badge_color, row_bg = severity_colors.get(severity, ("#888", "#f9f9f9"))

        rows_html += f"""
        <tr style="background:{row_bg}; border-bottom:1px solid #eee;">
            <td style="padding:12px 16px; vertical-align:top;">
                <span style="
                    display:inline-block;
                    padding:3px 10px;
                    border-radius:12px;
                    background:{badge_color};
                    color:#fff;
                    font-size:12px;
                    font-weight:700;
                    letter-spacing:0.5px;
                ">{severity}</span>
            </td>
            <td style="padding:12px 16px; vertical-align:top; color:#1a1a2e; font-weight:600;">
                {issue.get("issue_type", "Unknown Issue")}
            </td>
            <td style="padding:12px 16px; vertical-align:top;">
                <code style="
                    display:block;
                    background:#f4f4f8;
                    padding:6px 10px;
                    border-radius:4px;
                    font-size:12px;
                    color:#333;
                    word-break:break-all;
                ">{issue.get("log_entry", "")[:200]}</code>
            </td>
            <td style="padding:12px 16px; vertical-align:top; color:#333; font-size:13px;">
                {issue.get("remediation", "Review the logs and take appropriate action.")}
            </td>
        </tr>
        """

    source_label = f"Source: <b>{log_source}</b>" if log_source else ""

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0; padding:0; font-family:Arial,sans-serif; background:#f0f2f5;">
      <div style="max-width:900px; margin:30px auto; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%); padding:28px 32px;">
          <h1 style="margin:0; color:#fff; font-size:22px; letter-spacing:0.5px;">
            Log Alert - Critical/High Severity Issues Detected
          </h1>
          <p style="margin:6px 0 0; color:#a0aec0; font-size:13px;">
            {len(issues)} issue(s) require your attention. {source_label}
          </p>
        </div>
        <div style="padding:24px 32px;">
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="background:#f7f8fa; border-bottom:2px solid #e2e8f0;">
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Severity</th>
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Issue Type</th>
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Log Entry</th>
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Remediation</th>
              </tr>
            </thead>
            <tbody>
              {rows_html}
            </tbody>
          </table>
        </div>
        <div style="padding:16px 32px; background:#f7f8fa; border-top:1px solid #e2e8f0; text-align:center;">
          <p style="margin:0; color:#a0aec0; font-size:12px;">
            This is an automated alert from your Log Analysis System. Please do not reply to this email.
          </p>
        </div>
      </div>
    </body>
    </html>
    """
    return html


def send_alert_email(
    issues: List[Dict[str, Any]],
    to_email: str,
    log_source: str = "",
) -> bool:
    """Send an alert email for CRITICAL/HIGH severity log issues."""
    load_dotenv(ENV_PATH, override=True)
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = (os.getenv("SMTP_USER") or "").strip()
    smtp_pass = (os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD") or "").replace(" ", "").strip()

    if not smtp_user or not smtp_pass:
        logger.warning("SMTP_USER or SMTP_PASSWORD not configured - skipping alert email.")
        return False

    subject = f"Alert: {len(issues)} Critical/High Severity Log Issue(s) Detected"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = to_email

    html_body = build_email_html(issues, log_source=log_source)
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, to_email, msg.as_string())
        logger.info(f"Alert email sent to {to_email} for {len(issues)} issue(s).")
        return True
    except Exception as e:
        logger.error(f"Failed to send alert email: {e}")
        return False
