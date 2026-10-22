import React, { useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  Globe,
  Key,
  Layers,
  Save,
  Server,
  Settings,
  Shield,
  Sliders,
} from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  const [appService, setAppService] = useState('miraai-auditsphere-dev');
  const [resourceGroup, setResourceGroup] = useState('MiraAI-AuditSphere');
  const [subscriptionId, setSubscriptionId] = useState('902c816f-b3a0-41b7-a6e7-bea44dde47e8');
  const [environment, setEnvironment] = useState('Production');
  const [alertEmail, setAlertEmail] = useState('admin@company.com');
  const [cpuThreshold, setCpuThreshold] = useState(80);
  const [ramThreshold, setRamThreshold] = useState(85);
  const [diskThreshold, setDiskThreshold] = useState(85);
  const [savedToast, setSavedToast] = useState(false);

  const handleSave = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl font-heading flex items-center gap-2.5">
          <Settings className="w-7 h-7 text-blue-500" />
          Settings & Environment Configuration
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage Azure cloud connections, AI incident agents, email notifications, and metric thresholds.
        </p>
      </div>

      {savedToast && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Settings saved successfully!
        </div>
      )}

      {/* Cloud Environment Settings */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2 font-heading">
          <Cloud className="w-5 h-5 text-blue-500" />
          Azure Monitor & Resource Targeting
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-muted-foreground mb-1.5">Target App Service Name</label>
            <input
              type="text"
              value={appService}
              onChange={(e) => setAppService(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-muted-foreground mb-1.5">Resource Group</label>
            <input
              type="text"
              value={resourceGroup}
              onChange={(e) => setResourceGroup(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground font-mono"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block font-semibold text-muted-foreground mb-1.5">Subscription ID</label>
            <input
              type="text"
              value={subscriptionId}
              onChange={(e) => setSubscriptionId(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-muted-foreground mb-1.5">Environment Tag</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground"
            >
              <option value="Production">Production</option>
              <option value="Staging">Staging</option>
              <option value="Development">Development</option>
            </select>
          </div>
        </div>
      </div>

      {/* Alert Thresholds */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#111c33] p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2 font-heading">
          <Bell className="w-5 h-5 text-amber-500" />
          Alert Threshold Rules & Notification Channel
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-muted-foreground mb-1.5">CPU Warning Threshold (%)</label>
            <input
              type="number"
              value={cpuThreshold}
              onChange={(e) => setCpuThreshold(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-muted-foreground mb-1.5">RAM Warning Threshold (%)</label>
            <input
              type="number"
              value={ramThreshold}
              onChange={(e) => setRamThreshold(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-muted-foreground mb-1.5">Disk Warning Threshold (%)</label>
            <input
              type="number"
              value={diskThreshold}
              onChange={(e) => setDiskThreshold(Number(e.target.value))}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground font-mono"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block font-semibold text-muted-foreground mb-1.5">Alert Recipient Email</label>
            <input
              type="email"
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-750 bg-slate-50 dark:bg-slate-900/60 text-foreground font-mono"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm shadow-md transition-all cursor-pointer"
        >
          <Save className="w-4 h-4" />
          Save Configurations
        </button>
      </div>
    </div>
  );
};

export default SettingsScreen;
