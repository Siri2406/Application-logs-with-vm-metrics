import React, { useState, useRef, useEffect } from 'react';
import {
  Activity,
  Bot,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
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

  // Fallback parsing if LLM output was formatted as natural text
  if (issues.length === 0) {
    const sevMatch = content.match(/\b(CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/i);
    const detectedSev = (sevMatch ? sevMatch[1].toUpperCase() : 'LOW') as any;

    let issueTitle = 'Application Operational Finding';
    const titleMatch = content.match(/(?:Issue Type|Issue|Incident|Title|Problem):\s*([^\n]+)/i);
    if (titleMatch) {
      issueTitle = titleMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
    }

    let logSnippet = '';
    const snippetMatch =
      content.match(/```(?:log|text)?\s*([\s\S]*?)```/i) ||
      content.match(/`([^`]+)`/) ||
      content.match(/(?:Log Entry:)\s*([^\n]+)/i);
    if (snippetMatch) {
      logSnippet = snippetMatch[1].trim();
    }

    let remText = content;
    const remMatch = content.match(/(?:Remediation|Remediation Steps):\s*([\s\S]*?)$/i);
    if (remMatch) {
      remText = remMatch[1].trim();
    }

    issues.push({
      id: 'issue-fallback',
      severity: detectedSev,
      issueType: issueTitle,
      logEntry: logSnippet || 'Active log telemetry evaluated.',
      remediation: remText,
    });
  }

  return issues;
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
  const [selectedFile, setSelectedFile] = useState<string>('live:azure');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [keywordFilter, setKeywordFilter] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load saved sessions on mount or create default session matching the UI
  useEffect(() => {
    const init = async () => {
      try {
        const sessData = await apiService.getApplicationSessions();
        if (sessData.sessions && sessData.sessions.length > 0) {
          setSessions(sessData.sessions);
          setActiveSessionId(sessData.sessions[0].id);
        } else {
          const defaultSess: ApplicationSession = {
            id: 'azure-live-logs',
            name: 'Azure Live Logs',
            messages: [],
          };
          setSessions([defaultSess]);
          setActiveSessionId(defaultSess.id);
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
        const defaultSess: ApplicationSession = {
          id: 'azure-live-logs',
          name: 'Azure Live Logs',
          messages: [],
        };
        setSessions([defaultSess]);
        setActiveSessionId(defaultSess.id);
      }
    };
    init();
  }, []);

  // Save sessions on changes
  const saveSessionsDebounced = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      name: selectedFile === 'live:gcp' ? 'GCP Live Logs' : 'Azure Live Logs',
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

  const handleRunAnalysis = async (
    targetFile?: string,
    targetSeverity?: string,
    targetKeyword?: string
  ) => {
    let currentId = activeSessionId;
    if (!currentId) {
      currentId = Date.now().toString();
      const newSession: ApplicationSession = {
        id: currentId,
        name: selectedFile === 'live:gcp' ? 'GCP Live Logs' : 'Azure Live Logs',
        messages: [],
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(currentId);
    }

    setIsAnalyzing(true);

    const activeTarget = targetFile !== undefined ? targetFile : selectedFile;
    const activeSev = targetSeverity !== undefined ? targetSeverity : severityFilter;
    const activeKw = targetKeyword !== undefined ? targetKeyword : keywordFilter;

    const isGcp = activeTarget === 'live:gcp';
    const isAzure = activeTarget === 'live:azure';
    const analyzePayload = isGcp ? 'analyze:live:gcp' : isAzure ? 'analyze:live:azure' : `analyze:${activeTarget}`;
    const provider = isGcp ? 'gcp' : 'azure';

    try {
      const res = await apiService.analyzeApplicationLogs({
        text: analyzePayload,
        cloudProvider: provider,
        severityFilter: activeSev !== 'ALL' ? activeSev : undefined,
        keywordFilter: activeKw,
      });

      const rawLogs = res.analyzed_logs || '';

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== currentId) return s;
          const updatedMessages = [
            ...s.messages,
            {
              role: 'agent' as const,
              content: res.response,
              analyzedLogs: rawLogs,
              timestamp: new Date().toLocaleTimeString(),
            },
          ];
          return {
            ...s,
            name: s.name === 'New Analysis' || s.name === 'New Investigation' ? (res.file_name || 'Azure Live Logs') : s.name,
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

  useEffect(() => {
    if (initialFilter) {
      const sev = initialFilter.severity || 'ALL';
      const kw = initialFilter.keyword || '';
      const prov = initialFilter.provider === 'gcp' ? 'live:gcp' : 'live:azure';
      setSeverityFilter(sev);
      setKeywordFilter(kw);
      setSelectedFile(prov);
      handleRunAnalysis(prov, sev, kw);
    }
  }, [initialFilter]);

  return (
    <div className="space-y-4">
      {/* 1. Top Header Row matching the image */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-xl font-bold font-heading text-foreground">
          Application Reliability Agent
        </h1>

        <div className="flex items-center gap-2.5">
          {/* Source Dropdown */}
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111c33] px-3 py-1.5 text-xs text-foreground font-medium focus:outline-hidden cursor-pointer"
          >
            <option value="live:azure">Azure Live Logs</option>
            <option value="live:gcp">GCP Live Logs</option>
          </select>

          {/* Severity Dropdown */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111c33] px-3 py-1.5 text-xs text-foreground font-medium focus:outline-hidden cursor-pointer"
          >
            <option value="ALL">All Severities (2)</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>

          {/* Analyze Button */}
          <button
            onClick={() => handleRunAnalysis()}
            disabled={isAnalyzing}
            className="rounded-lg bg-[#124b80] hover:bg-[#0e3c66] text-white px-5 py-1.5 text-xs font-semibold shadow-xs transition-all disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <span>Analyze</span>
            )}
          </button>
        </div>
      </div>

      {/* 2. Main Body: Left Sidebar + Right Diagnosis Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pt-2">
        {/* Left Sidebar */}
        <div className="lg:col-span-3 xl:col-span-2 space-y-2">
          <button
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#155a8a] hover:bg-[#124a73] px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer mb-3"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Analysis</span>
          </button>

          <div className="space-y-1.5">
            {sessions.map((sess) => {
              const isActive = sess.id === activeSessionId;
              return (
                <div
                  key={sess.id}
                  onClick={() => setActiveSessionId(sess.id)}
                  className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#194c73] text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{sess.name || 'Azure Live Logs'}</span>
                  </div>
                  <button
                    onClick={(e) => deleteSession(e, sess.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-300 transition-opacity"
                    title="Delete session"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Content Area: Findings Feed */}
        <div className="lg:col-span-9 xl:col-span-10 space-y-6">
          {isAnalyzing && (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium">
              <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
              <span>Analyzing live application logs with Azure OpenAI reliability agent...</span>
            </div>
          )}

          {messages.length === 0 && !isAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              <Bot className="h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-semibold text-foreground">Application Reliability Workspace</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Click <strong className="text-foreground">Analyze</strong> in the top right to evaluate active application logs and generate real-time AI diagnosis.
              </p>
            </div>
          ) : (
            messages
              .filter((m) => m.role === 'agent' || !m.role)
              .map((msg, idx) => {
                const issues = parseAgentIssues(msg.content);
                const logContent =
                  msg.analyzedLogs ||
                  (idx > 0 && messages[idx - 1]?.role === 'user'
                    ? messages[idx - 1].content.replace(/^Analyzed logs for[^\n]*\n\n/, '')
                    : '');
                const linesCount = logContent
                  ? logContent.trim().split('\n').filter(Boolean).length
                  : 501;

                return (
                  <div key={idx} className="space-y-4">
                    {/* Cyan Analyzed Log Content Box matching the image */}
                    {logContent && (
                      <div className="rounded-2xl overflow-hidden shadow-xs bg-[#009de0]">
                        <div className="px-5 py-2.5 flex items-center justify-between text-white border-b border-white/10">
                          <div className="flex items-center gap-2">
                            <Activity className="h-4 w-4" />
                            <span className="text-xs font-black tracking-wider uppercase">
                              ANALYZED LOG CONTENT
                            </span>
                          </div>
                          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                            {linesCount} lines
                          </span>
                        </div>
                        <div className="p-4 text-white font-mono text-[11px] leading-relaxed max-h-48 overflow-y-auto scrollbar-thin whitespace-pre-wrap select-text">
                          {logContent}
                        </div>
                      </div>
                    )}

                    {/* Structured Diagnosis Cards matching the image */}
                    {issues.map((issue) => (
                      <div
                        key={issue.id}
                        className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-6 shadow-xs space-y-4"
                      >
                        {/* 1. Severity */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-900 dark:text-white min-w-[75px]">
                            Severity:
                          </span>
                          <span
                            className={`rounded-md px-2.5 py-0.5 text-[11px] font-bold border uppercase ${
                              issue.severity === 'LOW'
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700'
                                : issue.severity === 'MEDIUM'
                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700'
                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-700'
                            }`}
                          >
                            {issue.severity}
                          </span>
                        </div>

                        {/* 2. Issue Type */}
                        <div className="flex items-baseline gap-3">
                          <span className="text-xs font-bold text-slate-900 dark:text-white min-w-[75px]">
                            Issue Type:
                          </span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {issue.issueType}
                          </span>
                        </div>

                        {/* 3. Log Entry */}
                        <div className="space-y-1.5">
                          <div className="text-xs font-bold text-slate-900 dark:text-white">
                            Log Entry:
                          </div>
                          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-800 dark:text-slate-200 leading-relaxed overflow-x-auto">
                            {issue.logEntry}
                          </div>
                        </div>

                        {/* 4. Remediation */}
                        <div className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                          <span className="font-bold text-slate-900 dark:text-white mr-1.5">
                            Remediation:
                          </span>
                          <span>{issue.remediation}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
          )}
          <div ref={chatEndRef} />
        </div>
      </div>
    </div>
  );
};

export default ApplicationAgentScreen;
