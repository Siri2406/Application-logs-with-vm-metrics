import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react';
import { RemediationReviewCard } from './RemediationReviewCard';
import type { RemediationAlternativeOption } from '../../types';

export interface RemediationOptionItem {
  id: string;
  label: string;
  badge: string;
  command: string;
  actionType: string;
  targetIdentifier: string;
  signal?: number;
  description: string;
  isPrimary?: boolean;
}

export interface RemediationActionSelectorProps {
  planId: string;
  serviceName?: string;
  primaryCommand: string;
  primaryRationale?: string;
  primaryTarget?: string;
  primaryActionType?: string;
  alternatives?: RemediationAlternativeOption[];
  status?: 'PENDING' | 'EXECUTING' | 'EXECUTED' | 'REJECTED' | 'FAILED';
  statusDetails?: {
    message?: string;
    command?: string;
    target?: string;
    actionType?: string;
    details?: Record<string, any>;
    timestamp?: string;
  };
  onApprove: (selected: RemediationOptionItem) => void;
  onReject: () => void;
  onRerunAnalysis?: () => void;
  onReset?: () => void;
  onViewHistory?: () => void;
}

export const RemediationActionSelector: React.FC<RemediationActionSelectorProps> = ({
  planId,
  serviceName = 'System Service',
  primaryCommand,
  primaryRationale,
  primaryTarget = 'system',
  primaryActionType = 'COMMAND',
  alternatives = [],
  status = 'PENDING',
  statusDetails,
  onApprove,
  onReject,
  onRerunAnalysis,
  onReset,
  onViewHistory,
}) => {
  // Build unified options list with Primary as #1, plus agent alternatives as #2 and #3
  const options: RemediationOptionItem[] = [
    {
      id: 'opt-primary',
      label: 'Recommended Strategy',
      badge: 'Agent Primary',
      command: primaryCommand,
      actionType: primaryActionType,
      targetIdentifier: primaryTarget,
      description: primaryRationale || 'Directly synthesized from live telemetry evidence and logs.',
      isPrimary: true,
    },
  ];

  if (Array.isArray(alternatives)) {
    alternatives.forEach((alt, idx) => {
      if (alt && alt.command && alt.command.trim() !== primaryCommand.trim()) {
        options.push({
          id: `opt-alt-${idx + 1}`,
          label: alt.label || `Alternative Strategy ${idx + 1}`,
          badge: `Option ${idx + 2}`,
          command: alt.command,
          actionType: alt.action_type || 'COMMAND',
          targetIdentifier: alt.target_identifier || primaryTarget,
          signal: alt.signal,
          description: alt.description || 'Contextual operational trade-off formulated from logs.',
          isPrimary: false,
        });
      }
    });
  }

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const selectedOption = options[selectedIndex] || options[0];

  if (status === 'EXECUTED') {
    return (
      <div className="mt-3">
        <RemediationReviewCard
          actionId={planId}
          actionType={statusDetails?.actionType || selectedOption.actionType}
          target={statusDetails?.target || selectedOption.targetIdentifier}
          command={statusDetails?.command || selectedOption.command}
          message={statusDetails?.message}
          details={statusDetails?.details}
          timestamp={statusDetails?.timestamp}
          onRerunAnalysis={onRerunAnalysis}
          onViewHistory={onViewHistory}
          onReset={onReset}
        />
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Header Explaining Agent-Formulated Options */}
      <div className="flex items-center justify-between pb-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--primary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--primary)]" />
          Agent Remediation Options ({options.length} Formulated from Logs)
        </span>
        <span className="text-[11px] text-muted-foreground font-mono">
          Target: {selectedOption.targetIdentifier || serviceName}
        </span>
      </div>

      {/* Option Cards (Selectable 1, 2, or 3) */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((opt, idx) => {
          const isSelected = selectedIndex === idx;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelectedIndex(idx)}
              className={`relative flex flex-col text-left p-3 rounded-[var(--radius-md)] border transition-all cursor-pointer ${
                isSelected
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10 ring-1 ring-[var(--primary)] shadow-sm'
                  : 'border-border/60 bg-card/60 hover:border-border hover:bg-card/90'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 mb-1.5">
                <span className="font-semibold text-xs text-foreground truncate">
                  {opt.label}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider shrink-0 ${
                    opt.isPrimary
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                  }`}
                >
                  {opt.badge}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed flex-1">
                {opt.description}
              </p>

              <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between">
                <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[150px]">
                  {opt.actionType}
                </span>
                <div className="flex items-center gap-1">
                  {isSelected ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--primary)]">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Selected
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground hover:text-foreground">
                      Click to choose
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Dynamic Terminal Preview for Currently Selected Option */}
      <div className="rounded-[var(--radius-sm)] border border-[#1E293B] bg-[#090D16] p-3 text-xs font-mono shadow-inner">
        <div className="flex items-center justify-between pb-1.5 border-b border-white/5 mb-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
            <Terminal className="h-3.5 w-3.5" /> Selected SSH Command ({selectedOption.label})
          </span>
          <span className="text-[10px] text-muted-foreground uppercase">
            Host: miraai-auditsphere-dev
          </span>
        </div>
        <div className="flex items-center gap-2 text-[#38BDF8] select-all bg-black/40 px-2.5 py-1.5 rounded border border-white/5 overflow-x-auto">
          <span className="text-muted-foreground select-none">$</span>
          <code className="font-bold">{selectedOption.command}</code>
        </div>
      </div>

      {/* Autonomous Recommendation & Host Execution Bar (HITL Kept Aside) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Zap className="h-3 w-3 text-primary" /> Mode:
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Sparkles className="h-3 w-3" /> Autonomous Agent Recommendation
          </span>
          {status === 'EXECUTED' && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> Applied on VM
            </span>
          )}
          {status === 'FAILED' && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> Execution Failed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApprove(selectedOption)}
            disabled={status === 'EXECUTING'}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
          >
            {status === 'EXECUTING' ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Executing {selectedOption.label}...
              </>
            ) : (
              <>
                <Terminal className="h-3.5 w-3.5" /> Execute Recommended Action ({selectedOption.badge})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
