import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertCircle,
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
  onNavigate: (tab: NavigationTab, filter?: { severity?: string; keyword?: string; provider?: string }) => void;
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


export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  onNavigate,
  cpuData,
  diskData,
  memoryData,
  alertsData,
  isLoadingAll: _isLoadingAll,
  isCpuLoading: _isCpuLoading,
  isDiskLoading: _isDiskLoading,
  isMemoryLoading: _isMemoryLoading,
  onRerunAll,
  onRerunCpu: _onRerunCpu,
  onRerunDisk: _onRerunDisk,
  onRerunMemory: _onRerunMemory,
  lastUpdated: _lastUpdated,
}) => {
  // --- Live Application Logs State ---
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO'>('ALL');
  const [resourceFilter, setResourceFilter] = useState<string>('ALL');
  const [isPaused, setIsPaused] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLogId, setSelectedLogId] = useState<string | number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    title: string;
    subtitle: string;
    severity: string;
    explanation: string;
    likelyCause: string;
    remediationSteps: string[];
  } | null>(null);

  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Helper to parse log severity
  const classifySeverity = (raw: string): 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO' => {
    const lower = raw.toLowerCase();
    if (lower.includes('500') || lower.includes('fatal') || lower.includes('oom') || lower.includes('crash')) {
      return 'CRITICAL';
    } else if (lower.includes('error') || lower.includes('exception') || lower.includes('fail')) {
      return 'ERROR';
    } else if (lower.includes('warn') || lower.includes('timeout')) {
      return 'WARNING';
    }
    return 'INFO';
  };

  // Helper to parse log resource
  const classifyResource = (raw: string): 'Azure App Service' | 'Virtual Machine' | 'Azure Monitor' => {
    const lower = raw.toLowerCase();
    if (lower.includes('vm') || lower.includes('host') || lower.includes('machine')) {
      return 'Virtual Machine';
    } else if (lower.includes('metric') || lower.includes('monitor') || lower.includes('diag')) {
      return 'Azure Monitor';
    }
    return 'Azure App Service';
  };

  const fetchLiveLogs = useCallback(async () => {
    try {
      const data = await apiService.getRecentApplicationLogs('azure', 50);
      if (data && data.logs && data.logs.length > 0) {
        const mapped: LogItem[] = data.logs
          .filter((line) => {
            const low = line.toLowerCase();
            return !low.includes('welcome, you are now connected') && !low.includes('connected to log-streaming');
          })
          .map((line, idx) => {
            const tsMatch = line.match(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/);
            const now = new Date();
            const defaultTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
              now.getDate()
            ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
              2,
              '0'
            )}:${String(now.getSeconds()).padStart(2, '0')}`;
            const timeStr = tsMatch ? tsMatch[0].replace('T', ' ') : defaultTime;

            return {
              id: `live-${Date.now()}-${idx}`,
              time: timeStr,
              severity: classifySeverity(line),
              resource: classifyResource(line),
              message: line.slice(0, 160),
            };
          });
        setLogs(mapped.reverse());
      }
    } catch (err) {
      console.error('Failed to fetch initial live logs:', err);
    }
  }, []);

  // Clear existing logs and fetch fresh logs from service & log stream
  const handleRefreshLiveLogs = useCallback(async () => {
    setLogs([]); // Immediately remove current logs
    setIsRefreshingLogs(true);
    setCurrentPage(1);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      const url = apiService.getLogStreamUrl('azure');
      eventSourceRef.current = new EventSource(url);
    }

    try {
      await fetchLiveLogs();
    } finally {
      setIsRefreshingLogs(false);
    }
  }, [fetchLiveLogs]);

  // Fetch initial live logs on mount
  useEffect(() => {
    fetchLiveLogs();
  }, [fetchLiveLogs]);

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

        // Ignore Kudu welcome greeting or connection banner
        const lower = raw.toLowerCase();
        if (lower.includes('welcome, you are now connected') || lower.includes('connected to log-streaming')) {
          return;
        }

        const sev = classifySeverity(raw);
        const res = classifyResource(raw);

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

        setLogs((prev) => [newEntry, ...prev.slice(0, 99)]);
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
    if (severityFilter !== 'ALL') {
      if (severityFilter === 'HIGH') {
        if (log.severity !== 'CRITICAL' && log.severity !== 'ERROR') return false;
      } else if (severityFilter === 'MEDIUM') {
        if (log.severity !== 'WARNING') return false;
      } else if (severityFilter === 'LOW') {
        if (log.severity !== 'INFO') return false;
      } else if (log.severity !== severityFilter) {
        return false;
      }
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

  const categoryCounts = logs.reduce(
    (acc, log) => {
      if (log.severity === 'CRITICAL' || log.severity === 'ERROR') acc.HIGH++;
      else if (log.severity === 'WARNING') acc.MEDIUM++;
      else acc.LOW++;
      return acc;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 }
  );

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const displayedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Compute live severity from recent 30 live logs
  const recent30Logs = logs.slice(0, 30);
  const recentHighCount = recent30Logs.filter(
    (l) => l.severity === 'CRITICAL' || l.severity === 'ERROR'
  ).length;
  const recentMediumCount = recent30Logs.filter((l) => l.severity === 'WARNING').length;
  const recentLowCount = recent30Logs.filter((l) => l.severity === 'INFO').length;

  const currentLiveSeverity: 'High' | 'Medium' | 'Low' =
    recentHighCount > 0 ? 'High' : recentMediumCount > 0 ? 'Medium' : 'Low';

  const activeDisplaySeverity = analysisResult?.severity || currentLiveSeverity;

  // Trigger AI Log Analysis on recent live logs & trigger agent VM telemetry
  const handleAnalyzeLogs = async () => {
    setIsAnalyzing(true);
    try {
      // Trigger all VM agents so CPU, Disk, Memory and Alerts reflect current application VM data
      if (onRerunAll) {
        onRerunAll();
      }

      const recentLogs = logs.slice(0, 30);
      const filteredRecent =
        severityFilter !== 'ALL'
          ? recentLogs.filter((l) => {
              if (severityFilter === 'HIGH') return l.severity === 'CRITICAL' || l.severity === 'ERROR';
              if (severityFilter === 'MEDIUM') return l.severity === 'WARNING';
              if (severityFilter === 'LOW') return l.severity === 'INFO';
              return true;
            })
          : recentLogs;

      const logsToAnalyze = filteredRecent.length > 0 ? filteredRecent : recentLogs;
      const logLines = logsToAnalyze.map(
        (l) => `[${l.time}] [${l.severity}] ${l.resource}: ${l.message}`
      );
      const logText = logLines.length > 0 ? logLines.join('\n') : 'analyze:live:azure';

      const res = await apiService.analyzeApplicationLogs({
        text: logText,
        cloudProvider: 'azure',
        severityFilter: severityFilter !== 'ALL' ? severityFilter : undefined,
      });

      const resp = res.response || '';
      let explanation = '';
      let likelyCause = '';
      const remediationSteps: string[] = [];

      const explMatch = resp.match(/Explanation:\s*([\s\S]*?)(?=Likely Cause:|$)/i);
      if (explMatch) explanation = explMatch[1].trim();

      const causeMatch = resp.match(/Likely Cause:\s*([\s\S]*?)(?=Remediation Steps:|$)/i);
      if (causeMatch) likelyCause = causeMatch[1].trim();

      const remMatch = resp.match(/Remediation Steps:\s*([\s\S]*?)$/i);
      if (remMatch) {
        const lines = remMatch[1].split('\n');
        lines.forEach((l) => {
          const cleaned = l.replace(/^\d+[\.\)]\s*|-\s*/, '').trim();
          if (cleaned) remediationSteps.push(cleaned);
        });
      }

      const hasCrit = logsToAnalyze.some((l) => l.severity === 'CRITICAL' || l.severity === 'ERROR');
      const hasWarn = logsToAnalyze.some((l) => l.severity === 'WARNING');
      const targetSeverity: 'High' | 'Medium' | 'Low' = hasCrit ? 'High' : hasWarn ? 'Medium' : 'Low';

      setAnalysisResult({
        title: `AI Reliability Analysis (${logsToAnalyze.length} recent logs evaluated)`,
        subtitle: `Evaluated ${logsToAnalyze.length} live Azure telemetry logs at ${new Date().toLocaleTimeString()}`,
        severity: targetSeverity,
        explanation: explanation || resp,
        likelyCause: likelyCause,
        remediationSteps: remediationSteps,
      });
    } catch (err: any) {
      console.error('Failed to analyze logs:', err);
      setAnalysisResult(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Live Agent metrics: initialize to 0 until analyzed
  const cpuPercent = cpuData?.current_usage_percent ?? 0;
  const cpuPeak = cpuData?.peak_usage_percent ?? 0;
  const memStats = memoryData?.memory_stats;
  const memPercent = memoryData?.current_usage_percent ?? memStats?.current_percent ?? 0;
  const diskStats = diskData?.disk_stats;
  const diskPercent = diskData?.current_usage_percent ?? diskStats?.current_percent ?? 0;

  // Active analysis values - NO MOCK DATA until "Analyze logs" is executed!
  const isAnalyzed = analysisResult !== null;
  const activeAnalysis = analysisResult;

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
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {cpuData ? `${cpuPercent}%` : '0%'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  cpuData
                    ? cpuPercent >= 70
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : cpuPercent >= 50
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                }`}
              >
                {cpuData ? (cpuPercent >= 70 ? 'Critical' : cpuPercent >= 50 ? 'Warning' : 'Healthy') : 'Awaiting Run'}
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
            {cpuData ? `Peak ${cpuPeak}% · ${cpuData.records?.[0]?.cores ?? 4} cores` : '0% · 4 cores'}
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
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {memoryData ? `${memPercent}%` : '0%'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  memoryData
                    ? memPercent >= 70
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : memPercent >= 50
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                }`}
              >
                {memoryData ? (memPercent >= 70 ? 'Warning' : 'Healthy') : 'Awaiting Run'}
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
            {memStats?.total_gb ? `Used ${memStats.used_gb ?? 0} GB / ${memStats.total_gb} GB` : '0 GB / 0 GB'}
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
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {diskData ? `${diskPercent}%` : '0%'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  diskData
                    ? diskPercent >= 70
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : diskPercent >= 50
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                }`}
              >
                {diskData ? (diskPercent >= 70 ? 'Warning' : 'Healthy') : 'Awaiting Run'}
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
            {diskStats?.total_gb ? `Used ${diskStats.used_gb ?? 0} GB / ${diskStats.total_gb} GB` : '0 GB / 0 GB'}
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
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {alertsData?.total_alerts ?? 0}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  (alertsData?.total_alerts ?? 0) > 0
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                }`}
              >
                {alertsData?.alerts?.filter((a) => a.threshold_level === '100%').length ?? 0} Critical
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
            {alertsData?.alerts?.filter((a) => a.threshold_level !== '100%').length ?? 0} Warnings · 0 Info
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
              <span className="text-3xl font-extrabold text-foreground tracking-tight">
                {analysisResult || cpuData ? '100%' : '0%'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  analysisResult || cpuData
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                }`}
              >
                {analysisResult || cpuData ? 'Healthy' : 'Awaiting Run'}
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
            {analysisResult || cpuData ? 'Live telemetry evaluated' : 'Awaiting analysis run'}
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

            {/* Severity Category Selector Pills (ALL, HIGH, MEDIUM, LOW) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'ALL', label: 'All', count: logs.length, color: 'bg-blue-600' },
                { id: 'HIGH', label: 'High', count: categoryCounts.HIGH, color: 'bg-rose-600' },
                { id: 'MEDIUM', label: 'Medium', count: categoryCounts.MEDIUM, color: 'bg-amber-500' },
                { id: 'LOW', label: 'Low', count: categoryCounts.LOW, color: 'bg-emerald-600' },
              ].map((sev) => {
                const isSelected = severityFilter === sev.id;
                return (
                  <button
                    key={sev.id}
                    onClick={() => {
                      setSeverityFilter(sev.id as any);
                      setCurrentPage(1);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? `${sev.color} text-white shadow-xs`
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>●</span> {sev.label}
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-mono ${
                        isSelected ? 'bg-white/25 text-white' : 'bg-slate-200 dark:bg-slate-800 text-foreground'
                      }`}
                    >
                      {sev.count}
                    </span>
                  </button>
                );
              })}
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
                onClick={handleRefreshLiveLogs}
                disabled={isRefreshingLogs}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-muted-foreground transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh log list & reconnect stream"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
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

            {activeAnalysis && (
              <>
                {/* Dynamic Severity Badge Card based on recent live logs */}
                <div
                  className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 mb-4 transition-all ${
                    activeAnalysis.severity.toLowerCase() === 'high'
                      ? 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-900/40'
                      : activeAnalysis.severity.toLowerCase() === 'medium'
                      ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-900/40'
                      : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/40'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white mt-0.5 ${
                        activeAnalysis.severity.toLowerCase() === 'high'
                          ? 'bg-rose-500'
                          : activeAnalysis.severity.toLowerCase() === 'medium'
                          ? 'bg-amber-500'
                          : 'bg-emerald-600'
                      }`}
                    >
                      {activeAnalysis.severity.toLowerCase() === 'high' ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : activeAnalysis.severity.toLowerCase() === 'medium' ? (
                        <AlertCircle className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                        {activeAnalysis.title}
                      </h3>
                      {activeAnalysis.subtitle && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {activeAnalysis.subtitle}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold text-white shadow-xs ${
                      activeAnalysis.severity.toLowerCase() === 'high'
                        ? 'bg-rose-600'
                        : activeAnalysis.severity.toLowerCase() === 'medium'
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                    }`}
                  >
                    {activeAnalysis.severity} Severity
                  </span>
                </div>

                {/* Explanation Section */}
                <div className="space-y-3.5 text-xs">
                  {activeAnalysis.explanation && (
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-foreground mb-1">
                        <Lightbulb className="w-3.5 h-3.5 text-blue-500" />
                        <span>Explanation</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed pl-5 whitespace-pre-line">
                        {activeAnalysis.explanation}
                      </p>
                    </div>
                  )}

                  {/* Likely Cause Section */}
                  {activeAnalysis.likelyCause && (
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-foreground mb-1">
                        <Target className="w-3.5 h-3.5 text-blue-500" />
                        <span>Likely Cause</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed pl-5">
                        {activeAnalysis.likelyCause}
                      </p>
                    </div>
                  )}

                  {/* Remediation Steps Section */}
                  {activeAnalysis.remediationSteps && activeAnalysis.remediationSteps.length > 0 && (
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
                  )}
                </div>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={handleAnalyzeLogs}
              disabled={isAnalyzing}
              className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
              <span>{isAnalyzing ? 'Analyzing...' : 'Analyze logs'}</span>
            </button>

            <button
              onClick={() =>
                onNavigate('app-agent', {
                  severity: severityFilter !== 'ALL' ? severityFilter : activeDisplaySeverity.toUpperCase(),
                  provider: 'azure',
                })
              }
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
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    !cpuData
                      ? 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                      : cpuPercent >= 70
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : cpuPercent >= 50
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {!cpuData ? 'AWAITING RUN' : cpuPercent >= 70 ? 'CRITICAL' : cpuPercent >= 50 ? 'WARNING' : 'HEALTHY'}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <span className="text-2xl font-black text-foreground">
                    {cpuData ? `${cpuPercent}%` : '0%'}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5 font-medium">Current Utilization</span>
                </div>
                <svg className="h-5 w-16 text-blue-500" viewBox="0 0 60 20" fill="none">
                  <path d="M 0,16 Q 15,12 30,16 T 60,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Shaded description box */}
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                {!cpuData
                  ? 'Agent run pending. Click "Analyze logs" or view details to inspect live VM CPU metrics.'
                  : cpuPercent >= 70
                  ? `CPU utilization is critical (${cpuPercent}%). Sustained load detected on VM.`
                  : cpuPercent >= 50
                  ? `CPU utilization is elevated (${cpuPercent}%). Monitor for sustained high usage.`
                  : `CPU utilization is normal (${cpuPercent}%). All cores operating within limits.`}
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
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    !diskData
                      ? 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                      : diskPercent >= 70
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : diskPercent >= 50
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {!diskData ? 'AWAITING RUN' : diskPercent >= 70 ? 'CRITICAL' : diskPercent >= 50 ? 'WARNING' : 'HEALTHY'}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <span className="text-2xl font-black text-foreground">
                    {diskData ? `${diskPercent}%` : '0%'}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5 font-medium">Current Utilization</span>
                </div>
                <svg className="h-5 w-16 text-indigo-500" viewBox="0 0 60 20" fill="none">
                  <path d="M 0,18 Q 20,16 35,16 T 60,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Shaded description box */}
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                {!diskData
                  ? 'Agent run pending. Click "Analyze logs" or view details to inspect live VM Disk metrics.'
                  : diskPercent >= 70
                  ? `Disk utilization is critical (${diskPercent}% used). Immediate disk cleanup recommended.`
                  : diskPercent >= 50
                  ? `Disk space running low (${diskPercent}% used, ${diskStats?.free_gb ?? 0} GB free).`
                  : `Disk space is healthy (${diskPercent}% used, ${diskStats?.free_gb ?? 0} GB available).`}
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
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    !memoryData
                      ? 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                      : memPercent >= 70
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : memPercent >= 50
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {!memoryData ? 'AWAITING RUN' : memPercent >= 70 ? 'CRITICAL' : memPercent >= 50 ? 'WARNING' : 'HEALTHY'}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <span className="text-2xl font-black text-foreground">
                    {memoryData ? `${memPercent}%` : '0%'}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5 font-medium">Current Utilization</span>
                </div>
                <svg className="h-5 w-16 text-emerald-500" viewBox="0 0 60 20" fill="none">
                  <path d="M 0,16 Q 20,18 40,12 T 60,10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Shaded description box */}
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                {!memoryData
                  ? 'Agent run pending. Click "Analyze logs" or view details to inspect live VM Memory metrics.'
                  : memPercent >= 70
                  ? `Memory usage is critical (${memPercent}%). High RAM allocation detected.`
                  : memPercent >= 50
                  ? `Memory usage is elevated (${memPercent}%). Monitor resident processes.`
                  : `Memory usage is within normal range (${memPercent}%, ${memStats?.used_gb ?? 0} GB used).`}
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
