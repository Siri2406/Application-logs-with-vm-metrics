import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Cloud,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Network,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import { apiService } from '../../api/service';
import type { AzureAppServiceTelemetry, AzureProcessItem } from '../../types';

export const AzureMetricsScreen: React.FC = () => {
  const [data, setData] = useState<AzureAppServiceTelemetry | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'cpu' | 'mem' | 'pid'>('mem');

  const fetchTelemetry = async (force = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiService.getAzureMetrics(force);
      if (res.status === 'error') {
        setError(res.error || 'Failed to load Azure metrics');
      } else {
        setData(res);
        setLastRefreshed(new Date().toLocaleTimeString());
      }
    } catch (err: any) {
      console.error('Error fetching Azure telemetry:', err);
      setError(err?.message || 'Error communicating with backend');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry(false);
  }, []);

  const processes: AzureProcessItem[] = data?.processes || [];

  const filteredProcesses = processes
    .filter((p) => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return true;
      return (
        p.command.toLowerCase().includes(query) ||
        p.user.toLowerCase().includes(query) ||
        String(p.pid).includes(query)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'cpu') return b.cpu_percent - a.cpu_percent;
      if (sortBy === 'mem') return b.memory_percent - a.memory_percent;
      return a.pid - b.pid;
    });

  const cpuPercent = data?.cpu?.percent_cpu_used ?? 0;
  const memPercent = data?.memory?.percent_physical_used ?? 0;
  const workingSetMb = data?.memory?.working_set_mb ?? 0;
  const cpuTimeSec = data?.cpu?.cpu_time_seconds ?? 0;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-blue-900/30 via-cyan-900/20 to-slate-900/40 border border-blue-500/20 backdrop-blur-md">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
            <Cloud className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">Azure App Service Live Telemetry</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Azure Monitor
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Server className="w-3.5 h-3.5 text-blue-400" />
                App: <strong className="text-foreground">{data?.app_service || 'miraai-auditsphere-dev'}</strong>
              </span>
              <span>•</span>
              <span>RG: <strong className="text-foreground">{data?.resource_group || 'MiraAI-AuditSphere'}</strong></span>
              {data?.disk?.mounts?.[0]?.host && (
                <>
                  <span>•</span>
                  <span>Worker: <strong className="text-foreground">{data.disk.mounts[0].host}</strong></span>
                </>
              )}
              {lastRefreshed && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    Updated: {lastRefreshed}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => fetchTelemetry(true)}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20 self-start md:self-auto cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'Polling Azure...' : 'Refresh Azure Telemetry'}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          <strong>Telemetry Error:</strong> {error}
        </div>
      )}

      {/* 4 Core Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU Card */}
        <div className="p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-sm hover:border-blue-500/30 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Host CPU Usage</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{cpuPercent}%</span>
            <span className="text-xs text-muted-foreground">Host Machine</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 mt-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                cpuPercent > 80 ? 'bg-rose-500' : cpuPercent > 60 ? 'bg-amber-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(cpuPercent, 100)}%` }}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between text-xs text-muted-foreground">
            <span>App CPU Time</span>
            <span className="font-semibold text-foreground">{cpuTimeSec}s / 5m</span>
          </div>
        </div>

        {/* Memory Card */}
        <div className="p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-sm hover:border-purple-500/30 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Physical Memory</span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{memPercent}%</span>
            <span className="text-xs text-muted-foreground">Host RAM</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 mt-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                memPercent > 85 ? 'bg-rose-500' : memPercent > 70 ? 'bg-amber-500' : 'bg-purple-500'
              }`}
              style={{ width: `${Math.min(memPercent, 100)}%` }}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between text-xs text-muted-foreground">
            <span>Working Set</span>
            <span className="font-semibold text-foreground">{workingSetMb} MB</span>
          </div>
        </div>

        {/* Disk Card */}
        <div className="p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-sm hover:border-emerald-500/30 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Storage Mounts</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {data?.disk?.mounts?.length ? (
              data.disk.mounts.map((m) => (
                <div key={m.mount_path} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{m.mount_path}</span>
                  <span className="font-bold text-foreground">{m.usage_percent}%</span>
                </div>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No mounts detected</span>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between text-xs text-muted-foreground">
            <span>IO Read Rate</span>
            <span className="font-semibold text-foreground">{data?.disk?.io_read_ops_sec ?? 0} ops/s</span>
          </div>
        </div>

        {/* Process & Network Card */}
        <div className="p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-sm hover:border-amber-500/30 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Running Processes</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{data?.total_processes ?? 0}</span>
            <span className="text-xs text-muted-foreground">Active in container</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Detector active & healthy</span>
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between text-xs text-muted-foreground">
            <span>HTTP Requests</span>
            <span className="font-semibold text-foreground">{data?.network?.requests ?? 0} (5m)</span>
          </div>
        </div>
      </div>

      {/* Storage Mount Details Bar */}
      <div className="p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)]">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-400" />
          Disk Partition Details (Linux Host)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.disk?.mounts?.map((mount) => (
            <div
              key={mount.mount_path}
              className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-foreground">{mount.mount_path}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    mount.usage_percent > 80
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : mount.usage_percent > 60
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  {mount.usage_percent}% Used
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    mount.usage_percent > 80
                      ? 'bg-rose-500'
                      : mount.usage_percent > 60
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${mount.usage_percent}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">Host: {mount.host}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Live Process Explorer */}
      <div className="p-6 rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-blue-400" />
              Live Process Explorer ({filteredProcesses.length} / {processes.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live processes harvested from Azure App Service Diagnostic Detector (Linux container)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Box */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search command, PID, user..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 rounded-xl text-xs bg-slate-900/60 border border-slate-800 focus:outline-none focus:border-blue-500 text-foreground w-56"
              />
            </div>

            {/* Sort Buttons */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
              <button
                onClick={() => setSortBy('mem')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  sortBy === 'mem' ? 'bg-blue-600 text-white font-medium' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sort %MEM
              </button>
              <button
                onClick={() => setSortBy('cpu')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  sortBy === 'cpu' ? 'bg-blue-600 text-white font-medium' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sort %CPU
              </button>
              <button
                onClick={() => setSortBy('pid')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  sortBy === 'pid' ? 'bg-blue-600 text-white font-medium' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sort PID
              </button>
            </div>
          </div>
        </div>

        {/* Process Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800/80">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-muted-foreground border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4 font-semibold">PID</th>
                <th className="py-2.5 px-4 font-semibold">User</th>
                <th className="py-2.5 px-4 font-semibold">State</th>
                <th className="py-2.5 px-4 font-semibold text-right">% CPU</th>
                <th className="py-2.5 px-4 font-semibold text-right">% Memory</th>
                <th className="py-2.5 px-4 font-semibold text-right">CPU Time</th>
                <th className="py-2.5 px-4 font-semibold">Command</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredProcesses.length > 0 ? (
                filteredProcesses.map((p) => (
                  <tr key={p.pid} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-bold text-foreground">{p.pid}</td>
                    <td className="py-2.5 px-4 font-mono text-muted-foreground">{p.user}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                        {p.state || 'S'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-right font-medium text-blue-400">
                      {p.cpu_percent.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 font-mono text-right font-medium text-purple-400">
                      {p.memory_percent.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 font-mono text-right text-muted-foreground">{p.time}</td>
                    <td className="py-2.5 px-4 font-mono text-foreground max-w-md truncate" title={p.command}>
                      {p.command}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    No processes match the query "{searchQuery}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
