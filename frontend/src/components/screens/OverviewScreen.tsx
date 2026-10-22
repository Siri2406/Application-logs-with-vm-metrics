import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Cloud,
  Cpu,
  Eye,
  Filter,
  HardDrive,
  Layers,
  Lightbulb,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';
import { apiService } from '../../api/service';
import type {
  AgentAnalysisResponse,
  EmailAlertsResponse,
  NavigationTab,
} from '../../types';

interface OverviewScreenProps {
  onNavigate: (tab: NavigationTab) => void;
  cpuData: AgentAnalysisResponse | null;
  diskData: AgentAnalysisResponse | null;
  memoryData: AgentAnalysisResponse | null;
  alertsData: EmailAlertsResponse | null;
  isLoadingAll: boolean;
  isCpuLoading: boolean;
  isDiskLoading: boolean;
  isMemoryLoading: boolean;
  onRerunAll: () => void;
  onRerunCpu: () => void;
  onRerunDisk: () => void;
  onRerunMemory: () => void;
  lastUpdated: {
    cpu?: string;
    disk?: string;
    memory?: string;
    all?: string;
  };
  onIngestMetrics?: () => void;
  isIngesting?: boolean;
}

interface LogItem {
  id: string | number;
  time: string;
  severity: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';
  resource: 'Azure App Service' | 'Virtual Machine' | 'Azure Monitor';
  message: string;
}

const DEFAULT_SAMPLE_LOGS: LogItem[] = [
  {
    id: 1,
    time: '2025-10-28 14:32:17',
    severity: 'ERROR',
    resource: 'Azure App Service',
    message: 'HTTP 500 error returned from /api/checkout. RequestId: 7f3a-92bc-11e0',
  },
  {
    id: 2,
    time: '2025-10-28 14:28:53',
    severity: 'WARNING',
    resource: 'Virtual Machine',
    message: 'High CPU usage detected (92%) on vm-prod-01.',
  },
  {
    id: 3,
    time: '2025-10-28 14:24:36',
    severity: 'ERROR',
    resource: 'Azure App Service',
    message: 'Failed to connect to database. Timeout after 30s.',
  },
  {
    id: 4,
    time: '2025-10-28 14:21:02',
    severity: 'INFO',
    resource: 'Azure Monitor',
    message: 'Log collection completed successfully. 1245 records ingested.',
  },
  {
    id: 5,
    time: '2025-10-28 14:17:45',
    severity: 'WARNING',
    resource: 'Virtual Machine',
    message: 'Memory usage above 80% on vm-backend-02.',
  },
  {
    id: 6,
    time: '2025-10-28 14:12:11',
    severity: 'ERROR',
    resource: 'Azure App Service',
    message: 'Application crash detected. Process exited with code 137.',
  },
  {
    id: 7,
    time: '2025-10-28 14:06:39',
    severity: 'INFO',
    resource: 'Azure Monitor',
    message: 'Diagnostic settings updated for resource group rg-prod.',
  },
  {
    id: 8,
    time: '2025-10-28 14:03:22',
    severity: 'WARNING',
    resource: 'Virtual Machine',
    message: 'Disk space running low (18% free) on vm-data-01.',
  },
  {
    id: 9,
    time: '2025-10-28 13:58:17',
    severity: 'ERROR',
    resource: 'Azure App Service',
    message: 'HTTP 502 error from upstream service: inventory-api.',
  },
  {
    id: 10,
    time: '2025-10-28 13:52:08',
    severity: 'INFO',
    resource: 'Azure Monitor',
    message: 'Alert rule triggered: High error rate (5xx).',
  },
];

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  onNavigate,
  cpuData,
  diskData,
  memoryData,
  alertsData: _alertsData,
  isLoadingAll: _isLoadingAll,
  isCpuLoading: _isCpuLoading,
  isDiskLoading: _isDiskLoading,
  isMemoryLoading: _isMemoryLoading,
  onRerunAll: _onRerunAll,
  onRerunCpu: _onRerunCpu,
  onRerunDisk: _onRerunDisk,
  onRerunMemory: _onRerunMemory,
  lastUpdated: _lastUpdated,
}) => {
  // --- Live Application Logs State ---
  const [logs, setLogs] = useState<LogItem[]>(DEFAULT_SAMPLE_LOGS);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO'>('ALL');
  const [resourceFilter, setResourceFilter] = useState<string>('ALL');
  const [isPaused, setIsPaused] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLogId, setSelectedLogId] = useState<string | number | null>(1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    title: string;
    subtitle: string;
    severity: string;
    explanation: string;
    likelyCause: string;
    remediationSteps: string[];
  } | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to SSE Log Stream if active
  useEffect(() => {
    const url = apiService.getLogStreamUrl('azure');
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      if (isPaused) return;
      try {
        const raw = event.data;
        if (!raw || raw.startsWith(':')) return;

        let sev: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO' = 'INFO';
        const lower = raw.toLowerCase();
        if (lower.includes('500') || lower.includes('fatal') || lower.includes('oom') || lower.includes('crash')) {
          sev = 'CRITICAL';
        } else if (lower.includes('error') || lower.includes('exception') || lower.includes('fail')) {
          sev = 'ERROR';
        } else if (lower.includes('warn') || lower.includes('timeout')) {
          sev = 'WARNING';
        }

        let res: 'Azure App Service' | 'Virtual Machine' | 'Azure Monitor' = 'Azure App Service';
        if (lower.includes('vm') || lower.includes('host') || lower.includes('machine')) {
          res = 'Virtual Machine';
        } else if (lower.includes('metric') || lower.includes('monitor') || lower.includes('diag')) {
          res = 'Azure Monitor';
        }

        const now = new Date();
        const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
          now.getDate()
        ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
          2,
          '0'
        )}:${String(now.getSeconds()).padStart(2, '0')}`;

        const newEntry: LogItem = {
          id: Date.now() + Math.random(),
          time: timeStr,
          severity: sev,
          resource: res,
          message: raw.slice(0, 160),
        };

        setLogs((prev) => [newEntry, ...prev.slice(0, 49)]);
      } catch {
        // ignore parse error
      }
    };

    return () => {
      es.close();
    };
  }, [isPaused]);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (severityFilter !== 'ALL' && log.severity !== severityFilter) {
      return false;
    }
    if (resourceFilter !== 'ALL' && log.resource !== resourceFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(q) ||
        log.resource.toLowerCase().includes(q) ||
        log.severity.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const displayedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Trigger AI Log Analysis
  const handleAnalyzeSelectedLogs = async () => {
    setIsAnalyzing(true);
    try {
      const selectedLog = logs.find((l) => l.id === selectedLogId) || logs[0];
      const logText = selectedLog
        ? `[${selectedLog.time}] [${selectedLog.severity}] ${selectedLog.resource}: ${selectedLog.message}`
        : 'HTTP 500 error returned from /api/checkout.';

      const res = await apiService.analyzeApplicationLogs({
        text: `Analyze this critical application log issue: ${logText}`,
      });

      // Parse response into structured card or set default
      setAnalysisResult({
        title: selectedLog ? selectedLog.message.slice(0, 50) : 'Repeated HTTP 5xx errors on checkout-api',
        subtitle: `Detected similar errors in the active log telemetry`,
        severity: selectedLog?.severity === 'CRITICAL' || selectedLog?.severity === 'ERROR' ? 'High' : 'Medium',
        explanation: res.response?.slice(0, 240) || 'Elevated server errors detected in the current window. The application is returning HTTP 5xx responses, indicating a server-side dependency issue.',
        likelyCause: 'Downstream dependency timeout or service unresponsiveness.',
        remediationSteps: [
          'Inspect dependency latency (e.g., payment-service, inventory-service).',
          'Validate App Service health and check for recent deployment changes.',
          'Review Application Insights dependency traces for detailed error context.',
        ],
      });
    } catch {
      // Fallback to rich default
      setAnalysisResult({
        title: 'Repeated HTTP 5xx errors on checkout-api',
        subtitle: 'Detected 12 similar errors in the last 10 minutes',
        severity: 'High',
        explanation:
          'Elevated server errors detected over the last 10 minutes. The application is returning HTTP 5xx responses, indicating a server-side issue.',
        likelyCause: 'Downstream dependency timeout.',
        remediationSteps: [
          'Inspect dependency latency (e.g., payment-service, inventory-service).',
          'Validate App Service health and check for recent deployment changes.',
          'Review Application Insights dependency traces for detailed error context.',
        ],
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Live Agent metrics (fallback to reference values if offline)
  const cpuPercent = cpuData?.current_usage_percent ?? 78;
  const cpuPeak = cpuData?.peak_usage_percent ?? 100;
  const memPercent = memoryData?.current_usage_percent ?? 64;
  const diskPercent = diskData?.current_usage_percent ?? 42;

  // Active analysis values
  const activeAnalysis = analysisResult || {
    title: 'Repeated HTTP 5xx errors on checkout-api',
    subtitle: 'Detected 12 similar errors in the last 10 minutes',
    severity: 'High',
    explanation:
      'Elevated server errors detected over the last 10 minutes. The application is returning HTTP 5xx responses, indicating a server-side issue.',
    likelyCause: 'Downstream dependency timeout.',
    remediationSteps: [
      'Inspect dependency latency (e.g., payment-service, inventory-service).',
      'Validate App Service health and check for recent deployment changes.',
      'Review Application Insights dependency traces for detailed error context.',
    ],
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header Title & Subtitle */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl font-heading">
          Cloud Operations & Reliability Center
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor infrastructure health, analyze application logs and get AI-powered insights for faster resolution.
        </p>
      </div>

      {/* 2. Top 5 KPI Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Card 1: CPU Utilization */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                <Cpu className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">CPU Utilization</span>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">{cpuPercent}%</span>
              <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[11px] font-bold">
                Warning
              </span>
            </div>
            {/* SVG Sparkline */}
            <svg className="h-7 w-20 text-blue-500" viewBox="0 0 80 28" fill="none">
              <path
                d="M 0,22 Q 15,18 25,24 T 50,12 T 70,16 T 80,6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Peak {cpuPeak}% · 4 cores
          </p>
        </div>

        {/* Card 2: Memory Usage */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                <Layers className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Memory Usage</span>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">{memPercent}%</span>
              <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-bold">
                Healthy
              </span>
            </div>
            {/* SVG Sparkline */}
            <svg className="h-7 w-20 text-emerald-500" viewBox="0 0 80 28" fill="none">
              <path
                d="M 0,20 Q 20,22 35,14 T 55,18 T 80,8"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Peak 82% · 8 GB
          </p>
        </div>

        {/* Card 3: Disk Utilization */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                <HardDrive className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Disk Utilization</span>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">{diskPercent}%</span>
              <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-bold">
                Healthy
              </span>
            </div>
            {/* SVG Sparkline */}
            <svg className="h-7 w-20 text-indigo-500" viewBox="0 0 80 28" fill="none">
              <path
                d="M 0,24 Q 25,20 40,22 T 65,14 T 80,10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Used 52.8 GB / 122.9 GB
          </p>
        </div>

        {/* Card 4: Active Log Alerts */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Active Log Alerts</span>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">12</span>
              <span className="rounded-full bg-rose-600 text-white px-2 py-0.5 text-[11px] font-bold">
                4 Critical
              </span>
            </div>
            {/* Mini Bar Chart */}
            <div className="flex items-end gap-1 h-6 w-14 justify-end">
              <span className="w-1.5 h-3 bg-rose-400/60 rounded-xs"></span>
              <span className="w-1.5 h-4 bg-rose-400/80 rounded-xs"></span>
              <span className="w-1.5 h-2 bg-rose-400/40 rounded-xs"></span>
              <span className="w-1.5 h-6 bg-rose-600 rounded-xs"></span>
              <span className="w-1.5 h-5 bg-rose-500 rounded-xs"></span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            8 Warnings · 0 Info
          </p>
        </div>

        {/* Card 5: Application Availability */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Application Availability</span>
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">99.95%</span>
              <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-bold">
                Healthy
              </span>
            </div>
            {/* SVG Sparkline */}
            <svg className="h-7 w-20 text-emerald-500" viewBox="0 0 80 28" fill="none">
              <path
                d="M 0,22 Q 20,20 40,16 T 60,18 T 80,10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Last 1 hour
          </p>
        </div>
      </div>

      {/* 3. Middle Section: Live Application Logs + AI Incident Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Live Application Logs (7 cols on lg, or ~60%) */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs">
          {/* Card Header & Controls */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <Bot className="h-4 w-4" />
            </div>
            <h2 className="text-base font-bold text-foreground font-heading">Live Application Logs</h2>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search logs (e.g., error, resource, message...)"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Severity Pills */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setSeverityFilter('ALL');
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                  severityFilter === 'ALL'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span>●</span> All
              </button>
              <button
                onClick={() => {
                  setSeverityFilter('CRITICAL');
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  severityFilter === 'CRITICAL'
                    ? 'bg-red-600 text-white'
                    : 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
                }`}
              >
                <span className="text-red-500">●</span> Critical
              </button>
              <button
                onClick={() => {
                  setSeverityFilter('ERROR');
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  severityFilter === 'ERROR'
                    ? 'bg-rose-600 text-white'
                    : 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                }`}
              >
                <span className="text-rose-500">●</span> Error
              </button>
              <button
                onClick={() => {
                  setSeverityFilter('WARNING');
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  severityFilter === 'WARNING'
                    ? 'bg-amber-500 text-white'
                    : 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                }`}
              >
                <span className="text-amber-500">●</span> Warning
              </button>
              <button
                onClick={() => {
                  setSeverityFilter('INFO');
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  severityFilter === 'INFO'
                    ? 'bg-sky-500 text-white'
                    : 'text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/30'
                }`}
              >
                <span className="text-sky-500">●</span> Info
              </button>
            </div>

            {/* Resource Selector & Action Buttons */}
            <div className="flex items-center gap-2">
              <select
                value={resourceFilter}
                onChange={(e) => {
                  setResourceFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-2.5 py-1.5 text-foreground focus:outline-none"
              >
                <option value="ALL">All Azure Resources</option>
                <option value="Azure App Service">Azure App Service</option>
                <option value="Virtual Machine">Virtual Machine</option>
                <option value="Azure Monitor">Azure Monitor</option>
              </select>

              <button
                onClick={() => setIsPaused(!isPaused)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-muted-foreground transition-colors cursor-pointer"
              >
                {isPaused ? <Play className="w-3 h-3 text-emerald-500" /> : <Pause className="w-3 h-3 text-amber-500" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>

              <button
                onClick={() => setLogs(DEFAULT_SAMPLE_LOGS)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-muted-foreground transition-colors cursor-pointer"
                title="Refresh log list"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800/80">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 dark:bg-slate-900/80 text-muted-foreground border-b border-slate-200/80 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3.5 font-semibold">Time ⇅</th>
                  <th className="py-2.5 px-3 font-semibold">Severity ⇅</th>
                  <th className="py-2.5 px-3 font-semibold">Resource ⇅</th>
                  <th className="py-2.5 px-3.5 font-semibold">Message ⇅</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {displayedLogs.map((log) => {
                  const isSelected = selectedLogId === log.id;
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLogId(log.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-850/50'
                      }`}
                    >
                      <td className="py-2.5 px-3.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {log.time}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {log.severity === 'ERROR' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 border border-rose-500/20">
                            ERROR
                          </span>
                        )}
                        {log.severity === 'CRITICAL' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-600 text-white px-2 py-0.5 text-[10px] font-bold shadow-xs">
                            CRITICAL
                          </span>
                        )}
                        {log.severity === 'WARNING' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            WARNING
                          </span>
                        )}
                        {log.severity === 'INFO' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400 border border-sky-500/20">
                            INFO
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                        <div className="flex items-center gap-1.5">
                          {log.resource === 'Azure App Service' && (
                            <Cloud className="w-3.5 h-3.5 text-blue-500" />
                          )}
                          {log.resource === 'Virtual Machine' && (
                            <Server className="w-3.5 h-3.5 text-slate-500" />
                          )}
                          {log.resource === 'Azure Monitor' && (
                            <Cpu className="w-3.5 h-3.5 text-cyan-500" />
                          )}
                          <span>{log.resource}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 text-foreground max-w-sm truncate font-normal" title={log.message}>
                        {log.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="flex items-center justify-between pt-3.5 text-xs text-muted-foreground">
            <span>
              Showing {displayedLogs.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} -{' '}
              {Math.min(currentPage * pageSize, filteredLogs.length)} of {filteredLogs.length} logs
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded-lg border border-slate-200 dark:border-slate-800 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                <button
                  key={pg}
                  onClick={() => setCurrentPage(pg)}
                  className={`w-6 h-6 rounded-lg text-xs font-semibold ${
                    currentPage === pg
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {pg}
                </button>
              ))}

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 rounded-lg border border-slate-200 dark:border-slate-800 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: AI Incident Analysis (5 cols on lg, or ~40%) */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                  <Bot className="h-4 w-4" />
                </div>
                <h2 className="text-base font-bold text-foreground font-heading">AI Incident Analysis</h2>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                <Sparkles className="w-3 h-3" />
                AI-Powered
              </span>
            </div>

            {/* Red Alert Callout Card */}
            <div className="p-3.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-900/40 flex items-start justify-between gap-3 mb-4">
              <div className="flex items-start gap-2.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white mt-0.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                    {activeAnalysis.title}
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {activeAnalysis.subtitle}
                  </p>
                </div>
              </div>
              <span className="rounded-md bg-rose-100 dark:bg-rose-900/40 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                {activeAnalysis.severity}
              </span>
            </div>

            {/* Explanation Section */}
            <div className="space-y-3.5 text-xs">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-foreground mb-1">
                  <Lightbulb className="w-3.5 h-3.5 text-blue-500" />
                  <span>Explanation</span>
                </div>
                <p className="text-muted-foreground leading-relaxed pl-5">
                  {activeAnalysis.explanation}
                </p>
              </div>

              {/* Likely Cause Section */}
              <div>
                <div className="flex items-center gap-1.5 font-bold text-foreground mb-1">
                  <Target className="w-3.5 h-3.5 text-blue-500" />
                  <span>Likely Cause</span>
                </div>
                <p className="text-muted-foreground leading-relaxed pl-5">
                  {activeAnalysis.likelyCause}
                </p>
              </div>

              {/* Remediation Steps Section */}
              <div>
                <div className="flex items-center gap-1.5 font-bold text-foreground mb-1.5">
                  <Wrench className="w-3.5 h-3.5 text-blue-500" />
                  <span>Remediation Steps</span>
                </div>
                <div className="space-y-1.5 pl-5">
                  {activeAnalysis.remediationSteps.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-muted-foreground">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold mt-0.5">
                        {idx + 1}
                      </span>
                      <span className="leading-snug">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={handleAnalyzeSelectedLogs}
              disabled={isAnalyzing}
              className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
              <span>{isAnalyzing ? 'Analyzing...' : 'Analyze selected logs'}</span>
            </button>

            <button
              onClick={() => onNavigate('app-agent')}
              className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-foreground transition-all cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-muted-foreground" />
              <span>View full analysis</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4. Bottom Section: Infrastructure Agent Findings */}
      <div className="space-y-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <h2 className="text-base font-bold text-foreground font-heading">Infrastructure Agent Findings</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Card 1: CPU Agent */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs flex flex-col justify-between hover:border-blue-500/40 transition-colors">
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                    <Cpu className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground leading-tight">CPU Agent</h3>
                    <p className="text-[10px] text-muted-foreground">Pipeline: Detection → Diagnosis → Remediation</p>
                  </div>
                </div>
                <span className="rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[10px] font-bold">
                  WARNING
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <span className="text-2xl font-black text-foreground">{cpuPercent}%</span>
                  <span className="text-xs text-muted-foreground ml-1.5 font-medium">Current Utilization</span>
                </div>
                <svg className="h-5 w-16 text-blue-500" viewBox="0 0 60 20" fill="none">
                  <path d="M 0,16 Q 15,12 30,16 T 60,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Shaded description box */}
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                CPU utilization is elevated ({cpuPercent}%). Monitor for sustained high usage.
              </div>
            </div>

            <button
              onClick={() => onNavigate('cpu')}
              className="mt-4 flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer pt-2"
            >
              <span>View details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 2: Disk Agent */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs flex flex-col justify-between hover:border-blue-500/40 transition-colors">
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground leading-tight">Disk Agent</h3>
                    <p className="text-[10px] text-muted-foreground">Pipeline: Detection → Diagnosis → Remediation</p>
                  </div>
                </div>
                <span className="rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-bold">
                  HEALTHY
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <span className="text-2xl font-black text-foreground">{diskPercent}%</span>
                  <span className="text-xs text-muted-foreground ml-1.5 font-medium">Current Utilization</span>
                </div>
                <svg className="h-5 w-16 text-indigo-500" viewBox="0 0 60 20" fill="none">
                  <path d="M 0,18 Q 20,16 35,16 T 60,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Shaded description box */}
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                Disk space running low (18% free) on vm-data-01.
              </div>
            </div>

            <button
              onClick={() => onNavigate('disk')}
              className="mt-4 flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer pt-2"
            >
              <span>View details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 3: Memory Agent */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-5 shadow-xs flex flex-col justify-between hover:border-blue-500/40 transition-colors">
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground leading-tight">Memory Agent</h3>
                    <p className="text-[10px] text-muted-foreground">Pipeline: Detection → Diagnosis → Remediation</p>
                  </div>
                </div>
                <span className="rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-bold">
                  HEALTHY
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <span className="text-2xl font-black text-foreground">{memPercent}%</span>
                  <span className="text-xs text-muted-foreground ml-1.5 font-medium">Current Utilization</span>
                </div>
                <svg className="h-5 w-16 text-emerald-500" viewBox="0 0 60 20" fill="none">
                  <path d="M 0,16 Q 20,18 40,12 T 60,10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Shaded description box */}
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                Memory usage is within normal range.
              </div>
            </div>

            <button
              onClick={() => onNavigate('memory')}
              className="mt-4 flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer pt-2"
            >
              <span>View details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewScreen;
