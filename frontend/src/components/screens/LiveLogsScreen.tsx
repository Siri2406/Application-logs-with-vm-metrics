import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Activity,
  Bot,
  Check,
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
      const entry: LogEntry = {
        id: Date.now() + Math.random(),
        text: line,
        severity: classifyLine(line),
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

  useEffect(() => {
    connect();
    fetchStatus();
    const statusInterval = setInterval(fetchStatus, 5000);

    return () => {
      clearInterval(statusInterval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect, fetchStatus]);

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
    const matchesSeverity = severityFilter === 'ALL' || log.severity === severityFilter;
    return matchesText && matchesSeverity;
  });

  const counts = logs.reduce(
    (acc, log) => {
      acc[log.severity] = (acc[log.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
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
              onClick={() => onAnalyzeWithAgent(severityFilter, filter, cloudProvider)}
              className="flex items-center gap-2 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--primary)] to-[var(--primary-hover)] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:opacity-95 active:scale-98"
              title="Send current logs & filters to Application Reliability Agent"
            >
              <Bot className="h-4 w-4" />
              Analyze with Agent
            </button>

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
              onClick={connect}
              className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Reconnect stream"
            >
              <RefreshCw className={`h-4 w-4 ${connecting ? 'animate-spin' : ''}`} />
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

          {/* Severity Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {['ALL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'].map((sev) => {
              const count = sev === 'ALL' ? logs.length : counts[sev] || 0;
              const isSelected = severityFilter === sev;
              return (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-semibold transition-all ${
                    isSelected
                      ? 'bg-[var(--primary)] text-white shadow-xs'
                      : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span>{sev}</span>
                  <span
                    className={`rounded-full px-1 text-[10px] font-mono ${
                      isSelected ? 'bg-white/25 text-white' : 'bg-muted text-foreground'
                    }`}
                  >
                    {count}
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
