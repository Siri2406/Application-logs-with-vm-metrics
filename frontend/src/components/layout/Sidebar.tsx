import React from 'react';
import {
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Cpu,
  HardDrive,
  History,
  Layers,
  LayoutDashboard,
  Settings,
  Terminal,
} from 'lucide-react';
import type { NavigationTab } from '../../types';

interface SidebarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
}) => {
  const isDashboardActive = activeTab === 'dashboard' || activeTab === 'overview';

  const navItems = [
    {
      id: 'dashboard' as NavigationTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: null,
      isActive: isDashboardActive,
    },
    {
      id: 'app-logs' as NavigationTab,
      label: 'Application Log Monitoring',
      icon: Terminal,
      badge: 'Live',
      badgeColor: 'bg-emerald-500 text-white',
      isActive: activeTab === 'app-logs',
    },
    {
      id: 'app-agent' as NavigationTab,
      label: 'Agent Diagnosis',
      icon: Bot,
      badge: null,
      isActive: activeTab === 'app-agent',
    },
    {
      id: 'cpu' as NavigationTab,
      label: 'CPU Agent',
      icon: Cpu,
      badge: null,
      isActive: activeTab === 'cpu',
    },
    {
      id: 'disk' as NavigationTab,
      label: 'Disk Agent',
      icon: HardDrive,
      badge: null,
      isActive: activeTab === 'disk',
    },
    {
      id: 'memory' as NavigationTab,
      label: 'Memory Agent',
      icon: Layers,
      badge: null,
      isActive: activeTab === 'memory',
    },
    {
      id: 'alerts' as NavigationTab,
      label: 'Alerts',
      icon: Bell,
      badge: '12',
      badgeColor: 'bg-rose-500 text-white',
      isActive: activeTab === 'alerts',
    },
    {
      id: 'history' as NavigationTab,
      label: 'History',
      icon: History,
      badge: null,
      isActive: activeTab === 'history',
    },
    {
      id: 'settings' as NavigationTab,
      label: 'Settings',
      icon: Settings,
      badge: null,
      isActive: activeTab === 'settings',
    },
  ];

  return (
    <aside
      className={`sticky top-0 h-screen shrink-0 z-30 flex flex-col border-r border-[#172339] bg-[#0b1426] text-slate-200 transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-20 items-center justify-between border-b border-[#172339] px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30">
            <Cloud className="h-6 w-6 fill-white" />
          </div>

          {!isCollapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="font-heading text-sm font-bold tracking-tight text-white leading-tight">
                Cloud Operations &<br />Reliability Center
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onToggleCollapse}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-5 space-y-1.5 scrollbar-thin">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.isActive;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`group flex w-full items-center gap-3.5 rounded-xl px-3.5 py-3 text-sm font-medium transition-all ${
                active
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 transition-transform group-hover:scale-105 ${
                  active ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />

              {!isCollapsed && (
                <div className="flex flex-1 items-center justify-between">
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        item.badgeColor || 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
};

export default Sidebar;
