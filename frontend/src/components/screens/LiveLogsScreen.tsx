import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Filter,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Trash2,
} from 'lucide-react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { apiService } from '../../api/service';
import type { LogStreamStatus, Severity } from '../../types';

export type SeverityCategory = 'HIGH' | 'MEDIUM' | 'LOW';

export function getSeverityCategory(line: string, rawSeverity?: string): SeverityCategory {
  if (rawSeverity === 'CRITICAL' || rawSeverity === 'ERROR') return 'HIGH';
  if (rawSeverity === 'WARNING') return 'MEDIUM';
  if (rawSeverity === 'INFO' || rawSeverity === 'DEBUG') return 'LOW';

  const lower = line.toLowerCase();
  if (
    /\b(critical|error|exception|failed|failure|500|fatal|crash|panic|oom|out of memory)\b/i.test(lower)
  ) {
    return 'HIGH';
  }
  if (/\b(warn|warning|timeout|retry|deprecated)\b/i.test(lower)) {
    return 'MEDIUM';
  }
  return 'LOW';
}

const SEVERITY_PATTERNS = {
  CRITICAL: /\b(500|out of memory|oom|fatal|panic|crash)\b/i,
  ERROR: /\b(error|exception|failed|failure)\b/i,
  WARNING: /\b(warn|warning|timeout|retry|deprecated)\b/i,
  INFO: /\b(info|information|started|completed|success)\b/i,
};

function classifyLine(line: string): 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG' {
  for (const [severity, regex] of Object.entries(SEVERITY_PATTERNS)) {
    if (regex.test(line)) return severity as any;
  }
  return 'DEBUG';
}

const SEVERITY_STYLES: Record<
  string,
  { badge: string; text: string; bg: string; border: string }
> = {
  CRITICAL: {
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    text: 'text-red-600 dark:text-red-400 font-semibold',
    bg: 'bg-red-500/5',
    border: 'border-l-red-500',
  },
  ERROR: {
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    text: 'text-rose-600 dark:text-rose-400 font-medium',
    bg: 'bg-rose-500/5',
    border: 'border-l-rose-500',
  },
  WARNING: {
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/5',
    border: 'border-l-amber-500',
  },
  INFO: {
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
    text: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-500/5',
    border: 'border-l-sky-500',
  },
  DEBUG: {
    badge: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
    text: 'text-muted-foreground',
    bg: 'transparent',
    border: 'border-l-transparent',
  },
};

interface LogEntry {
  id: number;
  text: string;
  severity: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
  category: SeverityCategory;
  timestamp: Date;
}

interface LiveLogsScreenProps {
  onAnalyzeWithAgent: (severity?: string, keyword?: string, provider?: string) => void;
}

export const LiveLogsScreen: React.FC<LiveLogsScreenProps> = ({ onAnalyzeWithAgent }) => {
  const [cloudProvider, setCloudProvider] = useState<'azure' | 'gcp'>('azure');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [status, setStatus] = useState<LogStreamStatus | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pausedLogsRef = useRef<LogEntry[]>([]);
  const isPausedRef = useRef(false);

  useEffect(() => {
    isPausedRef.current = paused;
  }, [paused]);

  const scrollToBottom = useCallback(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [autoScroll]);

  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    setAutoScroll(isAtBottom);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiService.getLogStreamStatus(cloudProvider);
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [cloudProvider]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnecting(true);
    const streamUrl = apiService.getLogStreamUrl(cloudProvider);
    const es = new EventSource(streamUrl);

    es.onopen = () => {
      setConnected(true);
      setConnecting(false);
    };

    es.onmessage = (event) => {
      const line = event.data;
      if (!line || line.startsWith(':')) return;

      const lower = line.toLowerCase();
      if (lower.includes('welcome, you are now connected') || lower.includes('connected to log-streaming')) {
        return;
      }

      const rawSeverity = classifyLine(line);
      const category = getSeverityCategory(line, rawSeverity);

      const entry: LogEntry = {
        id: Date.now() + Math.random(),
        text: line,
        severity: rawSeverity,
        category,
        timestamp: new Date(),
      };

      if (isPausedRef.current) {
        pausedLogsRef.current.push(entry);
      } else {
        setLogs((prev) => {
          const updated = [...prev, entry];
          return updated.length > 2000 ? updated.slice(-2000) : updated;
        });
      }
    };

    es.onerror = () => {
      setConnected(false);
      setConnecting(false);
    };

    eventSourceRef.current = es;
  }, [cloudProvider]);

  // Clears current logs and fetches fresh logs from the log service & reconnects stream
  const handleRefreshLogs = useCallback(async () => {
    // 1. Immediately remove current logs from the screen
    setLogs([]);
    pausedLogsRef.current = [];
    setIsRefreshing(true);
    setConnecting(true);

    // 2. Close existing EventSource stream
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      // 3. Fetch latest new logs from log service
      const data = await apiService.getRecentApplicationLogs(cloudProvider, 50);
      if (data && data.logs && data.logs.length > 0) {
        const freshEntries: LogEntry[] = data.logs
          .filter((line) => {
            const lower = line.toLowerCase();
            return !lower.includes('welcome, you are now connected') && !lower.includes('connected to log-streaming');
          })
          .map((line, idx) => {
            const rawSeverity = classifyLine(line);
            const category = getSeverityCategory(line, rawSeverity);
            return {
              id: Date.now() + idx + Math.random(),
              text: line,
              severity: rawSeverity,
              category,
              timestamp: new Date(),
            };
          });
        setLogs(freshEntries);
      }
    } catch (err) {
      console.error('Failed to fetch new logs on refresh:', err);
    } finally {
      setIsRefreshing(false);
    }

    // 4. Re-establish stream connection
    connect();
    fetchStatus();
  }, [cloudProvider, connect, fetchStatus]);

  useEffect(() => {
    handleRefreshLogs();
    const statusInterval = setInterval(fetchStatus, 5000);

    return () => {
      clearInterval(statusInterval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [handleRefreshLogs, fetchStatus]);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const togglePause = () => {
    if (paused) {
      if (pausedLogsRef.current.length > 0) {
        setLogs((prev) => {
          const updated = [...prev, ...pausedLogsRef.current];
          return updated.length > 2000 ? updated.slice(-2000) : updated;
        });
        pausedLogsRef.current = [];
      }
      setPaused(false);
    } else {
      setPaused(true);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    pausedLogsRef.current = [];
  };

  const filteredLogs = logs.filter((log) => {
    const matchesText = filter ? log.text.toLowerCase().includes(filter.toLowerCase()) : true;
    if (!matchesText) return false;
    if (severityFilter === 'ALL') return true;
    if (severityFilter === 'HIGH') {
      return log.category === 'HIGH' || log.severity === 'CRITICAL' || log.severity === 'ERROR';
    }
    if (severityFilter === 'MEDIUM') {
      return log.category === 'MEDIUM' || log.severity === 'WARNING';
    }
    if (severityFilter === 'LOW') {
      return log.category === 'LOW' || log.severity === 'INFO' || log.severity === 'DEBUG';
    }
    return log.severity === severityFilter || log.category === severityFilter;
  });

  const categoryCounts = logs.reduce(
    (acc, log) => {
      acc[log.category] = (acc[log.category] || 0) + 1;
      return acc;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<SeverityCategory, number>
  );

  // Determine overall severity based on the recent live logs (last 30 logs)
  const recentLogs = logs.slice(-30);
  const recentHighCount = recentLogs.filter(
    (l) => l.category === 'HIGH' || l.severity === 'CRITICAL' || l.severity === 'ERROR'
  ).length;
  const recentMediumCount = recentLogs.filter(
    (l) => l.category === 'MEDIUM' || l.severity === 'WARNING'
  ).length;
  const recentLowCount = recentLogs.filter(
    (l) => l.category === 'LOW' || l.severity === 'INFO' || l.severity === 'DEBUG'
  ).length;

  const liveSeverity: SeverityCategory =
    recentHighCount > 0 ? 'HIGH' : recentMediumCount > 0 ? 'MEDIUM' : 'LOW';

  return (
    <div className="space-y-5">
      {/* 1. Header & Live Severity Badge Card */}
      <Card
        className={`p-4 md:p-5 border shadow-sm transition-all ${
          liveSeverity === 'HIGH'
            ? 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-300 dark:border-rose-900/60'
            : liveSeverity === 'MEDIUM'
            ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-900/60'
            : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-900/60'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md ${
                liveSeverity === 'HIGH'
                  ? 'bg-rose-600 shadow-rose-600/30'
                  : liveSeverity === 'MEDIUM'
                  ? 'bg-amber-500 shadow-amber-500/30'
                  : 'bg-emerald-600 shadow-emerald-600/30'
              }`}
            >
              {liveSeverity === 'HIGH' ? (
                <AlertTriangle className="h-6 w-6" />
              ) : liveSeverity === 'MEDIUM' ? (
                <AlertCircle className="h-6 w-6" />
              ) : (
                <CheckCircle2 className="h-6 w-6" />
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading text-base font-bold text-foreground">
                  Application Log Monitoring
                </span>
                {/* Particular Severity Badge Card based on recent live logs */}
                <span
                  className={`rounded-full px-3 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-white shadow-xs ${
                    liveSeverity === 'HIGH'
                      ? 'bg-rose-600'
                      : liveSeverity === 'MEDIUM'
                      ? 'bg-amber-500'
                      : 'bg-emerald-600'
                  }`}
                >
                  {liveSeverity} Severity Stream
                </span>

                {severityFilter !== 'ALL' && (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-foreground border border-border">
                    Filtered: {severityFilter} Only ({filteredLogs.length} logs)
                  </span>
                )}
              </div>

              <p className="text-xs text-muted-foreground mt-1">
                {liveSeverity === 'HIGH'
                  ? `Critical exceptions or 5xx server errors detected in recent stream (${recentHighCount} event${recentHighCount === 1 ? '' : 's'}). Immediate operational inspection recommended.`
                  : liveSeverity === 'MEDIUM'
                  ? `Warning events or timeout retries observed in recent telemetry (${recentMediumCount} warning event${recentMediumCount === 1 ? '' : 's'}).`
                  : `All recent telemetry indicates healthy operations with 0 error or crash events across ${recentLogs.length} evaluated log events.`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Recent telemetry breakdown badge */}
            <div className="flex items-center gap-1.5 text-[11px] font-mono rounded-xl bg-card border border-border px-3 py-1.5 shadow-2xs">
              <span className="text-muted-foreground font-sans">Recent Window:</span>
              <span className="text-rose-500 font-bold">{recentHighCount} High</span>
              <span>·</span>
              <span className="text-amber-500 font-bold">{recentMediumCount} Med</span>
              <span>·</span>
              <span className="text-emerald-500 font-bold">{recentLowCount} Low</span>
            </div>

            <button
              onClick={() => onAnalyzeWithAgent(severityFilter, filter, cloudProvider)}
              className="flex items-center gap-2 rounded-[var(--radius-md)] bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition-all hover:opacity-95 active:scale-98"
              title="Send current logs & selected severity filter to Agent Diagnosis"
            >
              <Bot className="h-4 w-4" />
              <span>Diagnose {severityFilter !== 'ALL' ? severityFilter : liveSeverity} with Agent</span>
            </button>
          </div>
        </div>
      </Card>

      {/* Top Banner / Stream Control Bar */}
      <Card className="p-4 md:p-6 border-border shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            {/* Cloud Provider Toggle */}
            <div className="flex items-center rounded-[var(--radius-md)] border border-border bg-muted/40 p-1">
              <button
                onClick={() => setCloudProvider('azure')}
                className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold transition-all ${
                  cloudProvider === 'azure'
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Cloud className="h-3.5 w-3.5" />
                Azure App Service
              </button>
              <button
                onClick={() => setCloudProvider('gcp')}
                className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold transition-all ${
                  cloudProvider === 'gcp'
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Server className="h-3.5 w-3.5" />
                GCP Compute Engine
              </button>
            </div>

            {/* Connection Status Pill */}
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-xs">
              <span className="relative flex h-2 w-2">
                {connected && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    connected
                      ? 'bg-[var(--success)]'
                      : connecting
                      ? 'bg-[var(--warning)] animate-pulse'
                      : 'bg-[var(--destructive)]'
                  }`}
                />
              </span>
              <span className="font-medium text-foreground">
                {connected ? 'Live Streaming' : connecting ? 'Connecting...' : 'Disconnected'}
              </span>
              {status?.app_service && (
                <span className="text-muted-foreground font-mono text-[11px] border-l border-border pl-2">
                  {status.app_service}
                </span>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={togglePause}
              className={`flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-medium transition-colors ${
                paused
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                  : 'bg-card text-foreground hover:bg-muted'
              }`}
            >
              {paused ? (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" /> Resume
                  {pausedLogsRef.current.length > 0 && ` (${pausedLogsRef.current.length})`}
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5 fill-current" /> Pause
                </>
              )}
            </button>

            <button
              onClick={clearLogs}
              className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Clear visible stream lines"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>

            <button
              onClick={handleRefreshLogs}
              disabled={isRefreshing || connecting}
              className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer disabled:opacity-50"
              title="Refresh logs & reconnect stream"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${connecting || isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="mt-4 flex flex-col gap-3 pt-3 border-t border-border sm:flex-row sm:items-center sm:justify-between">
          {/* Keyword Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter live logs by text or keyword..."
              className="w-full rounded-[var(--radius-md)] border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-[var(--primary)] focus:outline-hidden"
            />
            {filter && (
              <button
                onClick={() => setFilter('')}
                className="absolute right-2.5 top-2 text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>

          {/* Severity Category Selector Pills (ALL, HIGH, MEDIUM, LOW) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL', label: 'All Severities', count: logs.length, color: 'bg-blue-600' },
              { id: 'HIGH', label: 'High', count: categoryCounts.HIGH, color: 'bg-rose-600' },
              { id: 'MEDIUM', label: 'Medium', count: categoryCounts.MEDIUM, color: 'bg-amber-500' },
              { id: 'LOW', label: 'Low', count: categoryCounts.LOW, color: 'bg-emerald-600' },
            ].map((sev) => {
              const isSelected = severityFilter === sev.id;
              return (
                <button
                  key={sev.id}
                  onClick={() => setSeverityFilter(sev.id)}
                  className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                    isSelected
                      ? `${sev.color} text-white shadow-xs`
                      : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span>{sev.label}</span>
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-mono ${
                      isSelected ? 'bg-white/25 text-white' : 'bg-muted text-foreground'
                    }`}
                  >
                    {sev.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Terminal Display */}
      <Card className="overflow-hidden border-border bg-slate-950 text-slate-100 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              stream://{cloudProvider}-app-service-logs
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span>Showing {filteredLogs.length} lines</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded-sm accent-[var(--primary)]"
              />
              <span>Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Scrollable Log Lines */}
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="h-[560px] overflow-y-auto p-4 font-mono text-[11px] leading-relaxed select-text scrollbar-thin"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500">
              <Activity className="h-8 w-8 animate-pulse text-slate-600 mb-2" />
              <p>Waiting for application log stream events...</p>
              {filter && <p className="text-[11px] text-slate-600 mt-1">No lines matched filter "{filter}"</p>}
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              const sev = SEVERITY_STYLES[log.severity] || SEVERITY_STYLES.DEBUG;
              return (
                <div
                  key={log.id}
                  className={`flex items-start gap-2.5 py-0.5 px-2 rounded-xs hover:bg-slate-900/60 transition-colors border-l-2 ${sev.border}`}
                >
                  <span className="w-9 shrink-0 text-slate-600 select-none text-right font-mono text-[10px]">
                    {index + 1}
                  </span>
                  <span className="w-16 shrink-0 text-slate-500 text-[10px]">
                    {log.timestamp.toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span
                    className={`shrink-0 rounded-[3px] border px-1.5 py-0.2 text-[9px] font-bold ${sev.badge}`}
                  >
                    {log.severity}
                  </span>
                  <span className={`flex-1 break-all whitespace-pre-wrap ${sev.text}`}>
                    {log.text}
                  </span>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>
      </Card>
    </div>
  );
};
