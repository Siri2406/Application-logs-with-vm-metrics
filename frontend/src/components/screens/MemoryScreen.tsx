import React, { useState, useEffect } from 'react';
import {
  Activity,
  Layers,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { RemediationList } from '../common/RemediationList';
import { RemediationActionSelector } from '../common/RemediationActionSelector';
import type { AgentAnalysisResponse } from '../../types';
import { apiService } from '../../api/service';

interface MemoryScreenProps {
  data: AgentAnalysisResponse | null;
  isLoading: boolean;
  onRunAnalysis: () => void;
  lastUpdated?: string;
}

export const MemoryScreen: React.FC<MemoryScreenProps> = ({
  data,
  isLoading,
  onRunAnalysis,
  lastUpdated: _lastUpdated,
}) => {
  const [actionStatus, setActionStatus] = useState<{
    status: 'PENDING' | 'EXECUTING' | 'EXECUTED' | 'REJECTED' | 'FAILED';
    message?: string;
    command?: string;
    target?: string;
    actionType?: string;
    details?: Record<string, any>;
    timestamp?: string;
  }>({ status: 'PENDING' });

  // Reset statuses to clean slate when a new telemetry analysis arrives
  useEffect(() => {
    if (data?.timestamp) {
      setActionStatus({ status: 'PENDING' });
    }
  }, [data?.timestamp]);

  const detection = data?.detection;
  const remediation = data?.remediation;

  const memoryPlan = data?.remediation_plans?.[0];

  const handleRemediationDecision = async (
    decision: 'APPROVE' | 'REJECT',
    selectedOption?: any
  ) => {
    setActionStatus({ status: decision === 'APPROVE' ? 'EXECUTING' : 'REJECTED' });
    try {
      const topProc = data?.high_memory_processes?.[0] || data?.memory_stats?.primary_process;
      const fallbackTarget = topProc?.pid ? String(topProc.pid) : data?.service_name || 'memory-worker';
      const defaultCmd = memoryPlan?.command || remediation?.command || (topProc?.pid ? `sudo kill -15 ${topProc.pid}` : `sudo systemctl restart ${fallbackTarget}`);
      const cmd = (selectedOption?.command || defaultCmd).trim();
      const targetId = selectedOption?.targetIdentifier || selectedOption?.target_identifier || memoryPlan?.target_identifier || fallbackTarget;
      const actionType = selectedOption?.actionType || selectedOption?.action_type || (topProc?.pid ? 'KILL_PROCESS' : 'RESTART_SERVICE');

      const result = await apiService.submitRemediationDecision({
        action_id: `REMED-MEM-${Date.now()}`,
        decision,
        action_type: actionType,
        command: cmd,
        target_identifier: targetId,
        process_name: topProc?.process_name || data?.service_name || 'RAM consumer',
        operator_email: 'operator@dashboard',
        operator_note: `Triggered from Memory HITL screen`,
      });

      setActionStatus({
        status: result.status,
        message: result.message || (result.success ? 'Executed successfully on VM' : 'Execution failed'),
        command: result.command || cmd,
        target: targetId,
        actionType: actionType,
        details: result.details,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (err: any) {
      setActionStatus({
        status: 'FAILED',
        message: err.message || 'SSH execution error',
      });
    }
  };

  const memStats = data?.memory_stats;
  const evidence = detection?.evidence as {
    used_gb?: number;
    free_gb?: number;
    available_gb?: number;
    total_gb?: number;
    percent?: number;
  } | undefined;

  const usagePercent = memStats?.current_percent ?? evidence?.percent ?? data?.current_usage_percent ?? 0;
  const usedGb = memStats?.used_gb ?? evidence?.used_gb;
  const totalGb = memStats?.total_gb ?? evidence?.total_gb;
  const freeGb = memStats?.available_gb ?? evidence?.available_gb ?? evidence?.free_gb;
  const peakPercent = memStats?.peak_percent ?? data?.peak_usage_percent ?? usagePercent;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-14rem)] w-full">
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-xl)] border border-border bg-card p-10 text-center max-w-md w-full shadow-sm">
          <RefreshCw className="h-8 w-8 animate-spin text-[var(--primary)] mb-3" />
          <h3 className="font-heading text-sm font-semibold text-foreground">
            Running Memory Agent Analysis...
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Assessing RAM buffers, cache reclamation, and swap thresholds
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Screen Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          {/* <h2 className="mt-1 font-heading text-xl font-bold text-foreground">
            Memory Utilization Agent
          </h2> */}
        </div>


        <button
          onClick={onRunAnalysis}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[var(--primary-hover)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{isLoading ? 'Rerunning Memory Agent...' : 'Rerun Memory Agent'}</span>
        </button>
      </div>

      {/* Memory Utilization Meter & Gauges */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[var(--primary)]" />
              <span className="text-xs font-semibold text-foreground">Primary RAM Consumption</span>
            </div>
            <Badge variant={!data ? 'neutral' : usagePercent > 70 ? 'destructive' : usagePercent > 50 ? 'warning' : 'success'} size="sm">
              {!data ? 'AWAITING RUN' : `${usagePercent}% IN USE`}
            </Badge>
          </div>

          <div className="mt-4">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-muted-foreground">Used: {usedGb !== undefined ? `${usedGb} GB` : 'N/A'}</span>
              <span className="text-muted-foreground">Total: {totalGb !== undefined ? `${totalGb} GB` : 'N/A'}</span>
            </div>
            <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all duration-500 ${
                  usagePercent >= 50
                    ? 'bg-gradient-to-r from-[#00AAE7] to-[#8B0000]'
                    : 'bg-[#00AAE7]'
                }`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground font-mono">
              <span>0 GB</span>
              <span>Warning: {totalGb ? (totalGb * 0.5).toFixed(1) : '50%'} GB (50%)</span>
              <span>Critical: {totalGb ? (totalGb * 0.7).toFixed(1) : '70%'} GB (70%)</span>
              <span>{totalGb !== undefined ? `${totalGb} GB` : '100%'}</span>
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <span className="text-xs text-muted-foreground">Available / Free RAM</span>
          <div className="mt-2 font-heading text-2xl font-bold text-foreground">
            {freeGb !== undefined ? `${freeGb} GB` : 'N/A'}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Available capacity</p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <span className="text-xs text-muted-foreground">Peak RAM Utilization</span>
          <div className="mt-2 font-heading text-2xl font-bold text-foreground">
            {peakPercent}%
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Highest observed recording</p>
        </div>
      </div>

      {/* Email Alert Banner */}
      {/* <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3 text-xs text-[var(--status-warning-text)]">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-[var(--warning)]" />
          <span>
            Memory Alert Threshold: Exceeded <strong>70% limit</strong> ({usagePercent}%). Notification sent to <strong>sirivennelanarava@gmail.com</strong>.
          </span>
        </div>
        <Badge variant="warning" size="sm">ALERT SENT</Badge>
      </div> */}

      {/* Detection & Remediation Blocks */}
      {detection && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card
            title="Memory Anomaly Diagnosis"
            subtitle={`Status: ${detection.diagnosis_status || 'CONFIRMED'} (Confidence: ${Math.round((detection.confidence ?? 0.95) * 100)}%)`}
            
          >
            <div className="space-y-3 text-xs">
              <div>
                <span className="font-semibold text-muted-foreground">Summary:</span>
                <p className="mt-1 text-sm font-medium text-foreground">{detection.summary}</p>
              </div>
              {detection.root_cause && (
              <div>
                <span className="font-semibold text-muted-foreground">Root Cause:</span>
                <p className="mt-1 text-xs text-foreground bg-muted/30 p-2.5 rounded-[var(--radius-sm)] border border-border">
                  {detection.root_cause}
                </p>
              </div>
              )}
              {detection.explanation && (
              <div>
                <span className="font-semibold text-muted-foreground">Explanation:</span>
                <p className="mt-1 text-muted-foreground leading-relaxed">{detection.explanation}</p>
              </div>
              )}
              {detection.reasons && (
                <div>
                  <span className="font-semibold text-muted-foreground">Reasons:</span>
                  <ul className="mt-1 list-disc list-inside space-y-1 text-foreground/80">
                    {detection.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          <Card
            title="Formulated Memory Remediation"
            subtitle="Streaming Chunk Mitigation & Guardrails"
            action={
              <Badge variant="primary" size="sm">
                REMEDIATION DRAFTED
              </Badge>
            }
          >
            <div className="space-y-4 text-xs">
              {remediation?.action_required && (
                <div>
                  <span className="font-semibold text-muted-foreground">Required Action:</span>
                    <RemediationList text={remediation.action_required} className="text-sm font-medium" />
                </div>
              )}

              {remediation?.preventive_guardrail && (
                <div className="rounded-[var(--radius-md)] border border-[var(--primary)]/30 bg-[var(--primary-tint)] p-3">
                  <div className="flex items-center gap-1.5 font-semibold text-[var(--primary)]">
                    <ShieldCheck className="h-4 w-4" />
                    Proactive Guardrail:
                  </div>
                    <RemediationList text={remediation.preventive_guardrail} />
                </div>
              )}

              <RemediationActionSelector
                planId="REMED-RAM-001"
                serviceName={memoryPlan?.service_name || 'VM Memory'}
                primaryCommand={
                  memoryPlan?.command ||
                  remediation?.command ||
                  (data?.high_memory_processes?.[0]?.pid
                    ? `sudo kill -15 ${data?.high_memory_processes[0].pid}`
                    : `sudo systemctl restart ${data?.service_name || 'memory-worker'}`)
                }
                primaryRationale={
                  memoryPlan?.remediation_rationale ||
                  remediation?.remediation_rationale ||
                  'Evaluated telemetry: cycle high memory consumer to recover RAM headroom.'
                }
                primaryTarget={String(memoryPlan?.target_identifier || memoryPlan?.service_name || 'system')}
                primaryActionType={memoryPlan?.action_type || 'COMMAND'}
                alternatives={memoryPlan?.alternatives || remediation?.alternatives || []}
                status={actionStatus.status}
                statusDetails={actionStatus}
                onApprove={(selected) => handleRemediationDecision('APPROVE', selected)}
                onReject={() => handleRemediationDecision('REJECT')}
                onRerunAnalysis={onRunAnalysis}
                onReset={() => setActionStatus({ status: 'PENDING' })}
              />

              {actionStatus.message && (
                <p className="mt-2 text-[11px] text-muted-foreground bg-muted/30 p-1.5 rounded font-mono">
                  {actionStatus.message}
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Memory Utilization Analysis & Top Consuming Processes */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {data?.memory_utilization_analysis && (
          <Card
            title="RAM Telemetry Diagnosis"
            subtitle="Host JVM / Heap buffer and swap footprint assessment"
            action={<Badge variant="info" size="sm">TELEMETRY AUDIT</Badge>}
          >
            <div className="top-0 sticky max-h-[350px] overflow-y-auto rounded-[var(--radius-md)] border border-border bg-[#0B1220] p-3 text-[11px] font-mono text-[#E7EBF3] whitespace-pre-wrap leading-relaxed">
              <div className="flex items-center gap-1.5 pb-2 text-[var(--primary)] border-b border-white/10 mb-2">
                <Activity className="h-3.5 w-3.5" />
                <span className="font-semibold">Memory Pressure Analysis</span>
              </div>
              {data.memory_utilization_analysis}
            </div>
          </Card>
        )}

        {data?.high_memory_processes && data.high_memory_processes.length > 0 && (
          <Card
            title="Highest RAM Processes"
            subtitle="Top processes ranked by Resident Set Size (RSS)"
            action={<Badge variant="warning" size="sm">TOP {data.high_memory_processes.length} PROCS</Badge>}
          >
            <div className="top-0 sticky max-h-[350px] overflow-y-auto space-y-2">
              {data.high_memory_processes.map((proc, pIdx) => (
                <div
                  key={pIdx}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border/80 bg-muted/20 p-2.5 text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <span className="font-semibold text-foreground">{proc.process_name || proc.name || 'Unknown'}</span>
                      <span className="ml-1 text-[11px] text-muted-foreground">(PID: {proc.pid})</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {proc.memory_rss_mb && (
                      <span className="text-[11px] text-muted-foreground">{proc.memory_rss_mb} MB</span>
                    )}
                    <Badge variant={Number(proc.memory_percent) > 30 ? 'destructive' : 'warning'} size="sm">
                      {proc.memory_percent}% RAM
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Services Breakdown if available */}
      {data?.high_memory_services && data.high_memory_services.length > 0 && (
        <Card
          title="Service Daemon Allocations"
          subtitle="Systemd services tracked by memory watcher"
          action={<Badge variant="neutral" size="sm">DAEMONS</Badge>}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.high_memory_services.map((svc, sIdx) => (
              <div
                key={sIdx}
                className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border bg-card p-2.5 text-xs font-mono"
              >
                <div>
                  <span className="font-semibold text-foreground">{svc.service_name}</span>
                  <div className="text-[10px] text-[var(--success)]">{svc.active_state}</div>
                </div>
                <span className="font-bold text-[var(--primary)]">{svc.memory_percent}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
