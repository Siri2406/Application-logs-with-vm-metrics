import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Filter,
  Info,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { apiService } from '../../api/service';
import type { ApplicationSession } from '../../types';

interface IssueItem {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  issueType: string;
  logEntry: string;
  remediation: string;
  raw?: string;
}

const SEVERITY_COLORS: Record<string, { badge: string; border: string; bg: string }> = {
  CRITICAL: {
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    border: 'border-l-red-500',
    bg: 'bg-red-500/5',
  },
  HIGH: {
    badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
    border: 'border-l-orange-500',
    bg: 'bg-orange-500/5',
  },
  MEDIUM: {
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    border: 'border-l-amber-500',
    bg: 'bg-amber-500/5',
  },
  LOW: {
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    border: 'border-l-emerald-500',
    bg: 'bg-emerald-500/5',
  },
  INFO: {
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
    border: 'border-l-sky-500',
    bg: 'bg-sky-500/5',
  },
};

function parseAgentIssues(content: string): IssueItem[] {
  if (!content || typeof content !== 'string') return [];
  const issues: IssueItem[] = [];

  const lines = content.trim().split('\n');
  const tableRows = lines.filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));
  if (tableRows.length >= 3 && tableRows[0].toLowerCase().includes('severity')) {
    for (let i = 2; i < tableRows.length; i++) {
      const cols = tableRows[i]
        .split('|')
        .map((c) => c.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cols.length >= 4) {
        const rawSev = cols[0].replace(/\*+/g, '').trim().toUpperCase();
        if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(rawSev)) {
          issues.push({
            id: `issue-table-${i}`,
            severity: rawSev as any,
            issueType: cols[1].replace(/\*+/g, '').trim(),
            logEntry: cols[2].replace(/^`|`$/g, '').trim(),
            remediation: cols[3].trim(),
            raw: tableRows[i],
          });
        }
      }
    }
    if (issues.length > 0) return issues;
  }

  // Paragraph format: split by '---' first, or by Severity lines
  let blocks = content.split(/\n\s*---\s*\n/);
  if (blocks.length === 1) {
    const splitBySev = content.split(/(?=(?:^|\n)\s*(?:\*\*Severity:\*\*|Severity:))/i);
    if (splitBySev.length > 1) {
      blocks = splitBySev;
    }
  }

  blocks.forEach((block, idx) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    const sevMatch = trimmed.match(
      /(?:\*\*Severity:\*\*|Severity:|\*\*\[)\s*(CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/i
    );
    if (!sevMatch) return;
    const severity = sevMatch[1].toUpperCase() as any;

    let issueType = '';
    const typeMatch = trimmed.match(/(?:\*\*Issue Type:\*\*|Issue Type:|\s*—\s*)\s*([^\n]+)/i);
    if (typeMatch) {
      issueType = typeMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
    }

    let logEntry = '';
    const logMatch = trimmed.match(
      /(?:\*\*Log Entry:\*\*|Log Entry:|`)([\s\S]*?)(?:`|\n\s*\*\*Remediation|\n\s*Remediation)/i
    );
    if (logMatch) {
      logEntry = logMatch[1].replace(/^`|`$/g, '').trim();
    }

    let remediation = '';
    const remMatch = trimmed.match(
      /(?:\*\*Remediation:\*\*|Remediation:|\*\*Remediation Plan:\*\*)\s*([\s\S]*?)$/i
    );
    if (remMatch) {
      remediation = remMatch[1].trim();
    }

    issues.push({
      id: `issue-block-${idx}`,
      severity,
      issueType: issueType || 'Application Anomaly',
      logEntry: logEntry || trimmed.slice(0, 140),
      remediation: remediation || 'Review server logs and verify deployment health.',
      raw: trimmed,
    });
  });

  return issues;
}

// Clean markdown text renderer that formats bold, code, lists, and linebreaks
function MarkdownViewer({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);

  return (
    <div className="space-y-3 text-xs leading-relaxed text-foreground">
      {paragraphs.map((p, idx) => {
        // Table detection
        if (p.trim().startsWith('|') && p.includes('\n|')) {
          const rows = p.trim().split('\n');
          return (
            <div key={idx} className="my-3 overflow-x-auto rounded-[var(--radius-md)] border border-border">
              <table className="w-full text-left font-mono text-[11px]">
                <tbody>
                  {rows.map((row, rIdx) => {
                    if (row.includes('---')) return null;
                    const cols = row
                      .split('|')
                      .slice(1, -1)
                      .map((c) => c.trim());
                    const isHeader = rIdx === 0;
                    return (
                      <tr
                        key={rIdx}
                        className={isHeader ? 'bg-muted/70 font-bold border-b border-border' : 'border-b border-border/50 hover:bg-muted/20'}
                      >
                        {cols.map((col, cIdx) => (
                          <td key={cIdx} className="px-3 py-2">
                            {col}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }

        // Standard paragraph
        return (
          <p key={idx} className="whitespace-pre-wrap">
            {p}
          </p>
        );
      })}
    </div>
  );
}

interface ApplicationAgentScreenProps {
  initialFilter?: {
    severity?: string;
    keyword?: string;
    provider?: string;
  } | null;
}

export const ApplicationAgentScreen: React.FC<ApplicationAgentScreenProps> = ({ initialFilter }) => {
  const [sessions, setSessions] = useState<ApplicationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [mockFiles, setMockFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('live:azure');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [keywordFilter, setKeywordFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<'cards' | 'raw'>('cards');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialFilter) {
      if (initialFilter.severity) setSeverityFilter(initialFilter.severity);
      if (initialFilter.keyword !== undefined) setKeywordFilter(initialFilter.keyword);
      if (initialFilter.provider) {
        setSelectedFile(initialFilter.provider === 'gcp' ? 'live:gcp' : 'live:azure');
      }
    }
  }, [initialFilter]);

  // Load mock files and saved sessions on mount
  useEffect(() => {
    const init = async () => {
      try {
        const mockData = await apiService.getMockFiles();
        if (mockData.files && mockData.files.length > 0) {
          setMockFiles(mockData.files);
        }
      } catch (err) {
        console.error('Failed to load mock files:', err);
      }

      try {
        const sessData = await apiService.getApplicationSessions();
        if (sessData.sessions && sessData.sessions.length > 0) {
          setSessions(sessData.sessions);
          setActiveSessionId(sessData.sessions[0].id);
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
      }
    };
    init();
  }, []);

  // Save sessions on changes
  const saveSessionsDebounced = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (sessions.length === 0) return;
    if (saveSessionsDebounced.current) clearTimeout(saveSessionsDebounced.current);
    saveSessionsDebounced.current = setTimeout(() => {
      apiService.saveApplicationSessions(sessions).catch((e) => console.error('Auto-save sessions error:', e));
    }, 1000);
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSession ? activeSession.messages : [];

  const createNewSession = () => {
    const newId = Date.now().toString();
    const newSession: ApplicationSession = {
      id: newId,
      name: 'New Investigation',
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleRunAnalysis = async () => {
    let currentId = activeSessionId;
    if (!currentId) {
      currentId = Date.now().toString();
      const newSession: ApplicationSession = {
        id: currentId,
        name: 'Log Investigation',
        messages: [],
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(currentId);
    }

    setIsAnalyzing(true);

    const isGcp = selectedFile === 'live:gcp';
    const isAzure = selectedFile === 'live:azure';
    const analyzePayload = isGcp ? 'analyze:live:gcp' : isAzure ? 'analyze:live:azure' : `analyze:${selectedFile}`;
    const provider = isGcp ? 'gcp' : 'azure';

    try {
      const res = await apiService.analyzeApplicationLogs({
        text: analyzePayload,
        cloudProvider: provider,
        severityFilter,
        keywordFilter,
      });

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== currentId) return s;
          const updatedMessages = [
            ...s.messages,
            {
              role: 'user' as const,
              content: `Analyzed logs for ${res.file_name || selectedFile}\n\n${res.analyzed_logs || ''}`,
              timestamp: new Date().toLocaleTimeString(),
            },
            {
              role: 'agent' as const,
              content: res.response,
              timestamp: new Date().toLocaleTimeString(),
            },
          ];
          return {
            ...s,
            name: res.file_name || s.name,
            messages: updatedMessages,
          };
        })
      );
    } catch (err: any) {
      console.error('Agent analysis error:', err);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== currentId) return s;
          return {
            ...s,
            messages: [
              ...s.messages,
              {
                role: 'agent' as const,
                content: `Error during analysis: ${err.message || 'Unknown error occurred'}`,
                isError: true,
                timestamp: new Date().toLocaleTimeString(),
              },
            ],
          };
        })
      );
    } finally {
      setIsAnalyzing(false);
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      {/* Left Sidebar: Investigation Sessions */}
      <Card className="p-4 border-border shadow-sm lg:col-span-1 flex flex-col h-[740px]">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[var(--primary)]" />
            <span className="text-xs font-bold text-foreground">Sessions</span>
          </div>
          <button
            onClick={createNewSession}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs hover:bg-[var(--primary-hover)] transition-colors"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pt-3 space-y-1.5 scrollbar-thin">
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No sessions yet. Click "New" to start an investigation.
            </div>
          ) : (
            sessions.map((sess) => {
              const isActive = sess.id === activeSessionId;
              return (
                <div
                  key={sess.id}
                  onClick={() => setActiveSessionId(sess.id)}
                  className={`group flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-xs transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[var(--primary)]/15 text-[var(--primary)] font-semibold border border-[var(--primary)]/30'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <div className="truncate pr-2">
                    <div className="truncate">{sess.name || 'Untitled Session'}</div>
                    <div className="text-[10px] text-muted-foreground font-normal">
                      {sess.messages.length} message{sess.messages.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteSession(e, sess.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-500 transition-opacity"
                    title="Delete session"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Main Analysis Area */}
      <div className="flex flex-col gap-4 lg:col-span-3">
        {/* Controls Card */}
        <Card className="p-4 border-border shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
            {/* Target Log Source */}
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                Log Source
              </label>
              <select
                value={selectedFile}
                onChange={(e) => setSelectedFile(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:border-[var(--primary)] focus:outline-hidden"
              >
                <optgroup label="Live Stream Sources">
                  <option value="live:azure">Azure App Service (Live Stream)</option>
                  <option value="live:gcp">GCP Compute Engine (Live Stream)</option>
                </optgroup>
                {mockFiles.length > 0 && (
                  <optgroup label="Stored Server Logs (Mock)">
                    {mockFiles.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Severity Filter */}
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                Severity
              </label>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:border-[var(--primary)] focus:outline-hidden"
              >
                <option value="ALL">ALL Severities</option>
                <option value="CRITICAL">CRITICAL Only</option>
                <option value="HIGH">HIGH Only</option>
                <option value="MEDIUM">MEDIUM Only</option>
                <option value="LOW">LOW Only</option>
              </select>
            </div>

            {/* Keyword Search */}
            <div>
              <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                Keyword Filter
              </label>
              <input
                type="text"
                value={keywordFilter}
                onChange={(e) => setKeywordFilter(e.target.value)}
                placeholder="e.g. exception, timeout"
                className="w-full rounded-[var(--radius-md)] border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:border-[var(--primary)] focus:outline-hidden placeholder:text-muted-foreground"
              />
            </div>

            {/* Run Button */}
            <div>
              <button
                onClick={handleRunAnalysis}
                disabled={isAnalyzing}
                className="w-full flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--primary)] py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-[var(--primary-hover)] active:scale-98 disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Analyzing Logs...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Run AI Analysis
                  </>
                )}
              </button>
            </div>
          </div>
        </Card>

        {/* Chat / Findings Feed */}
        <Card className="flex flex-col h-[640px] p-4 border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-[var(--primary)]" />
              <span className="text-xs font-bold text-foreground">
                {activeSession?.name || 'Log Investigation Workspace'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode(viewMode === 'cards' ? 'raw' : 'cards')}
                className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {viewMode === 'cards' ? 'View Raw Report' : 'View Issue Cards'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-4 scrollbar-thin">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center p-8 text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)]/10 text-[var(--primary)] mb-3">
                  <Bot className="h-6 w-6" />
                </div>
                <h3 className="font-heading text-sm font-bold text-foreground mb-1">
                  Application Log Reliability Agent
                </h3>
                <p className="max-w-md text-xs leading-relaxed">
                  Select your target log source (Azure App Service, GCP Compute Engine, or sample logs)
                  and click <strong>Run AI Analysis</strong> to detect server errors, classify root causes,
                  and formulate remediation playbooks.
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                const issues = !isUser && !msg.isError ? parseAgentIssues(msg.content) : [];

                return (
                  <div
                    key={idx}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full`}
                  >
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {isUser ? 'Investigation Trigger' : 'Agent Diagnosis & RCA'}
                      </span>
                      {msg.timestamp && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {msg.timestamp}
                        </span>
                      )}
                    </div>

                    <div
                      className={`w-full rounded-[var(--radius-lg)] p-4 border transition-all ${
                        isUser
                          ? 'bg-muted/40 border-border text-foreground'
                          : msg.isError
                          ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                          : 'bg-card border-border text-foreground shadow-xs'
                      }`}
                    >
                      {isUser ? (
                        <div className="font-mono text-[11px] whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                          {msg.content}
                        </div>
                      ) : msg.isError ? (
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>{msg.content}</span>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Issue Cards View */}
                          {viewMode === 'cards' && issues.length > 0 ? (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-xs font-semibold pb-2 border-b border-border">
                                <span>Identified {issues.length} Operational Issue{issues.length === 1 ? '' : 's'}</span>
                                <button
                                  onClick={() => copyToClipboard(msg.content, `msg-${idx}`)}
                                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                  {copiedId === `msg-${idx}` ? (
                                    <>
                                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      Copy All
                                    </>
                                  )}
                                </button>
                              </div>

                              <div className="grid grid-cols-1 gap-3">
                                {issues.map((issue) => {
                                  const sevStyle =
                                    SEVERITY_COLORS[issue.severity] || SEVERITY_COLORS.INFO;
                                  return (
                                    <div
                                      key={issue.id}
                                      className={`rounded-[var(--radius-md)] border p-3 border-l-4 ${sevStyle.border} ${sevStyle.bg} border-border bg-card`}
                                    >
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          <span
                                            className={`rounded-xs border px-1.5 py-0.5 text-[10px] font-bold ${sevStyle.badge}`}
                                          >
                                            {issue.severity}
                                          </span>
                                          <span className="text-xs font-bold text-foreground">
                                            {issue.issueType}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Log Entry Snippet */}
                                      <div className="my-2 rounded-[var(--radius-sm)] bg-slate-950 p-2 font-mono text-[10px] text-slate-200 overflow-x-auto">
                                        {issue.logEntry}
                                      </div>

                                      {/* Recommended Remediation */}
                                      <div className="flex items-start gap-1.5 pt-1 text-[11px] text-foreground">
                                        <Wrench className="h-3.5 w-3.5 text-[var(--primary)] shrink-0 mt-0.5" />
                                        <div>
                                          <strong className="text-foreground">Remediation: </strong>
                                          <span className="text-muted-foreground">
                                            {issue.remediation}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            /* Raw / Full Markdown View */
                            <div>
                              <div className="flex justify-end pb-2">
                                <button
                                  onClick={() => copyToClipboard(msg.content, `raw-${idx}`)}
                                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                  {copiedId === `raw-${idx}` ? (
                                    <>
                                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      Copy Report
                                    </>
                                  )}
                                </button>
                              </div>
                              <MarkdownViewer text={msg.content} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>
        </Card>
      </div>
    </div>
  );
};
