import React from 'react';
import {
  ChevronDown,
  Clock,
  Cloud,
  Moon,
  Sun,
} from 'lucide-react';
import type { NavigationTab } from '../../types';

interface NavbarProps {
  activeTab: NavigationTab;
  isDark: boolean;
  onToggleTheme: () => void;
  onFetchMetrics?: () => void;
  isFetchingMetrics?: boolean;
  fetchStatusMessage?: string | null;
  unreadAlertCount: number;
  onSelectTab: (tab: NavigationTab) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab: _activeTab,
  isDark,
  onToggleTheme,
}) => {
  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-end border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-[#0f172a]/90 px-6 backdrop-blur-md transition-colors shadow-xs">
      {/* Right Controls */}
      <div className="flex items-center gap-3 text-xs">
        {/* Environment Selector */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300">
          <span className="text-muted-foreground text-[11px]">Environment</span>
          <span className="font-semibold text-foreground">Production</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground ml-0.5" />
        </div>

        {/* Source Selector */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300">
          <span className="text-muted-foreground text-[11px]">Source</span>
          <Cloud className="w-3.5 h-3.5 text-blue-500 fill-blue-500" />
          <span className="font-semibold text-foreground">Azure</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground ml-0.5" />
        </div>

        {/* Connected Pill */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Connected</span>
        </div>

        {/* Time Window Selector */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">Last 1 hour</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground ml-0.5" />
        </div>

        {/* Dark/Light Mode Toggle */}
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-xl text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>

        {/* User Avatar */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white font-semibold text-xs shadow-xs">
          SN
        </div>
      </div>
    </header>
  );
};

export default Navbar;
