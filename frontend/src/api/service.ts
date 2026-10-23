import type {
  AgentAnalysisResponse,
  AlertThresholdRule,
  ApplicationAgentResponse,
  ApplicationSession,
  EmailAlertsResponse,
  HealthCheckResponse,
  LogStreamStatus,
  MetricsFetchResult,
  RemediationDecisionPayload,
  RemediationDecisionResult,
  ThresholdRulesResponse,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_KEY = import.meta.env.VITE_API_KEY || 'localhost:8000';

class ApiService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = BASE_URL.replace(/\/$/, '');
    this.apiKey = API_KEY;
  }

  private getHeaders(contentType = 'application/json'): HeadersInit {
    return {
      'Content-Type': contentType,
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
    };
  }

  async checkHealth(): Promise<HealthCheckResponse> {
    const res = await fetch(`${this.baseUrl}/health`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`Health check failed: HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  async triggerMetricsFetch(): Promise<MetricsFetchResult> {
    const res = await fetch(`${this.baseUrl}/api/metrics/fetch`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to fetch live telemetry: ${errorText}`);
    }
    return await res.json();
  }

  async getEmailAlerts(): Promise<EmailAlertsResponse> {
    const res = await fetch(`${this.baseUrl}/api/metrics/alerts`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to load email alerts from API: ${errorText}`);
    }
    return await res.json();
  }

  async clearEmailAlerts(): Promise<EmailAlertsResponse> {
    const res = await fetch(`${this.baseUrl}/api/metrics/alerts/clear`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to clear email alerts: ${errorText}`);
    }
    return await res.json();
  }

  async getThresholdRules(): Promise<ThresholdRulesResponse> {
    const res = await fetch(`${this.baseUrl}/api/metrics/thresholds`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to fetch threshold rules: ${errorText}`);
    }
    return await res.json();
  }

  async createThresholdRule(rule: {
    resource: string;
    threshold_percent: number;
    severity?: string;
    recipient?: string;
    enabled?: boolean;
  }): Promise<{ success: boolean; rule: AlertThresholdRule; distinct_thresholds: number[] }> {
    const res = await fetch(`${this.baseUrl}/api/metrics/thresholds`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(rule),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to create threshold rule: ${errorText}`);
    }
    return await res.json();
  }

  async updateThresholdRule(
    id: number,
    rule: {
      resource?: string;
      threshold_percent?: number;
      severity?: string;
      recipient?: string;
      enabled?: boolean;
    }
  ): Promise<{ success: boolean; distinct_thresholds: number[] }> {
    const res = await fetch(`${this.baseUrl}/api/metrics/thresholds/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(rule),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to update threshold rule: ${errorText}`);
    }
    return await res.json();
  }

  async deleteThresholdRule(id: number): Promise<{ success: boolean; distinct_thresholds: number[] }> {
    const res = await fetch(`${this.baseUrl}/api/metrics/thresholds/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to delete threshold rule: ${errorText}`);
    }
    return await res.json();
  }

  async toggleThresholdRule(id: number): Promise<{ success: boolean; distinct_thresholds: number[] }> {
    const res = await fetch(`${this.baseUrl}/api/metrics/thresholds/${id}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to toggle threshold rule: ${errorText}`);
    }
    return await res.json();
  }

  async analyzeCpu(): Promise<AgentAnalysisResponse> {
    const res = await fetch(`${this.baseUrl}/api/cpu/analyze`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`CPU Agent API error (HTTP ${res.status}): ${errorText}`);
    }
    return await res.json();
  }

  async analyzeDisk(): Promise<AgentAnalysisResponse> {
    const res = await fetch(`${this.baseUrl}/api/disk/analyze`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Disk Agent API error (HTTP ${res.status}): ${errorText}`);
    }
    return await res.json();
  }

  async analyzeMemory(): Promise<AgentAnalysisResponse> {
    const res = await fetch(`${this.baseUrl}/api/memory/analyze`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Memory Agent API error (HTTP ${res.status}): ${errorText}`);
    }
    return await res.json();
  }



  async submitRemediationDecision(
    payload: RemediationDecisionPayload
  ): Promise<RemediationDecisionResult> {
    const res = await fetch(`${this.baseUrl}/api/remediation/decision`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Remediation failed: HTTP ${res.status}`);
    }
    return await res.json();
  }

  async testRemediationConnection(): Promise<{ success: boolean; message: string; host?: string; output?: string; error?: string }> {
    const res = await fetch(`${this.baseUrl}/api/remediation/test-connection`, {
      headers: this.getHeaders(),
    });
    return await res.json();
  }

  async getRemediationAuditLogs(limit = 100): Promise<{ total_records: number; logs: any[] }> {
    const res = await fetch(`${this.baseUrl}/api/remediation/audit-logs?limit=${limit}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      return { total_records: 0, logs: [] };
    }
    return await res.json();
  }

  async clearRemediationAuditLogs(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/remediation/audit-logs`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to clear audit logs' }));
      throw new Error(err.detail || 'Failed to clear audit logs');
    }
    return await res.json();
  }

  // --- Application Log Stream & Agent APIs ---

  getLogStreamUrl(source = 'azure'): string {
    return `${this.baseUrl}/api/application/logs/stream?source=${encodeURIComponent(source)}`;
  }

  async getLogStreamStatus(source = 'azure'): Promise<LogStreamStatus> {
    const res = await fetch(
      `${this.baseUrl}/api/application/logs/status?source=${encodeURIComponent(source)}`,
      { headers: this.getHeaders() }
    );
    if (!res.ok) {
      throw new Error(`Failed to load log stream status (HTTP ${res.status})`);
    }
    return await res.json();
  }

  async getRecentApplicationLogs(source = 'azure', limit = 50): Promise<{ logs: string[] }> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/application/logs/recent?source=${encodeURIComponent(source)}&limit=${limit}`,
        { headers: this.getHeaders() }
      );
      if (!res.ok) return { logs: [] };
      return await res.json();
    } catch {
      return { logs: [] };
    }
  }

  async getMockFiles(): Promise<{ files: string[]; error?: string }> {
    const res = await fetch(`${this.baseUrl}/api/mockfiles`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      return { files: [] };
    }
    return await res.json();
  }

  async getApplicationSessions(): Promise<{ sessions: ApplicationSession[] }> {
    const res = await fetch(`${this.baseUrl}/api/application/sessions`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      return { sessions: [] };
    }
    return await res.json();
  }

  async saveApplicationSessions(sessions: ApplicationSession[]): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/api/application/sessions`, {
      method: 'POST',
      headers: this.getHeaders('application/json'),
      body: JSON.stringify({ sessions }),
    });
    if (!res.ok) {
      throw new Error(`Failed to save application chat sessions (HTTP ${res.status})`);
    }
    return await res.json();
  }

  async analyzeApplicationLogs(params: {
    text: string;
    severityFilter?: string;
    keywordFilter?: string;
    cloudProvider?: string;
  }): Promise<ApplicationAgentResponse> {
    const body = new URLSearchParams({ text: params.text });
    if (params.cloudProvider) {
      body.append('cloud_provider', params.cloudProvider);
    }
    if (params.severityFilter && params.severityFilter !== 'ALL') {
      body.append('severity_filter', params.severityFilter);
    }
    if (params.keywordFilter && params.keywordFilter.trim()) {
      body.append('keyword_filter', params.keywordFilter.trim());
    }

    const res = await fetch(`${this.baseUrl}/api/application/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-API-Key': this.apiKey,
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Application Agent Error (HTTP ${res.status}): ${errorText}`);
    }

    return await res.json();
  }

  // --- Azure App Service & Monitor Metrics APIs ---

  async getAzureMetrics(forceRefresh = false): Promise<any> {
    const query = forceRefresh ? '?force_refresh=true' : '';
    const res = await fetch(`${this.baseUrl}/api/application/metrics/azure${query}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to fetch Azure metrics (HTTP ${res.status}): ${errorText}`);
    }
    return await res.json();
  }

  async getAzureProcesses(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/application/metrics/azure/processes`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to fetch Azure processes (HTTP ${res.status}): ${errorText}`);
    }
    return await res.json();
  }
}

export const apiService = new ApiService();
export default apiService;
