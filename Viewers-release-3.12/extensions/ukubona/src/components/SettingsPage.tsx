import React, { useState, useEffect } from 'react';
import * as tauri from '../tauriBridge';
import PacsConnector from './PacsConnector';

type TabId = 'pacs' | 'orthanc' | 'storage' | 'credits' | 'reports';

interface ReportSettings {
  autoSave: boolean;
  autoSaveInterval: number;
  cloudSync: boolean;
}

const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  autoSave: true,
  autoSaveInterval: 2,
  cloudSync: false,
};

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function IconPacs({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconOrthanc({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function IconStorage({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  );
}

function IconCredits({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="5" />
      <path d="M9 2a5 5 0 0 1 0 10" />
      <path d="M15 17a5 5 0 0 0 0-10" />
      <circle cx="15" cy="12" r="5" />
    </svg>
  );
}

function IconReports({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconClose({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Tab Definitions ──────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'pacs', label: 'PACS', icon: IconPacs },
  { id: 'orthanc', label: 'Orthanc', icon: IconOrthanc },
  { id: 'storage', label: 'Storage', icon: IconStorage },
  { id: 'credits', label: 'Credits', icon: IconCredits },
  { id: 'reports', label: 'Reports', icon: IconReports },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SettingsPage({ onClose, standalone = false }: { onClose: () => void; standalone?: boolean }) {
  const [tab, setTab] = useState<TabId>('pacs');
  const [settings, setSettings] = useState<tauri.AppSettings>({
    theme: 'dark',
    orthanc: { max_studies: 30 },
    ai: {},
  });
  const [reportSettings, setReportSettings] = useState<ReportSettings>(() => {
    try {
      const stored = localStorage.getItem('ukubona_report_settings');
      if (stored) return JSON.parse(stored) as ReportSettings;
    } catch { /* ignore */ }
    return DEFAULT_REPORT_SETTINGS;
  });
  const [storageStats, setStorageStats] = useState<tauri.StorageStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orthancStatus, setOrthancStatus] = useState<tauri.OrthancStatus | null>(null);

  useEffect(() => {
    // Seed host/port from the current localStorage URL so fields are pre-filled
    const currentUrl = tauri.getOrthancUrl();
    const urlMatch = currentUrl.match(/^https?:\/\/([^:]+):(\d+)/);
    const seedHost = urlMatch?.[1] ?? '127.0.0.1';
    const seedPort = urlMatch ? Number(urlMatch[2]) : 8042;

    Promise.all([
      tauri.getSettings().catch(() => null),
      tauri.getStorageStats().catch(() => null),
      tauri.getOrthancStatus().catch(() => null),
    ]).then(([s, stats, status]) => {
      setSettings(prev => {
        const base = s ?? prev;
        return {
          ...base,
          orthanc: {
            ...base.orthanc,
            host: base.orthanc.host ?? seedHost,
            port: base.orthanc.port ?? seedPort,
          },
        };
      });
      if (stats) setStorageStats(stats);
      if (status) setOrthancStatus(status);
      setLoading(false);
    });
  }, []);

  const [needsReload, setNeedsReload] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Persist Orthanc URL to localStorage so window.config picks it up on reload
      const host = settings.orthanc.host || '127.0.0.1';
      const port = settings.orthanc.port ?? 8042;
      const prevUrl = tauri.getOrthancUrl();
      const newUrl = `http://${host}:${port}`;
      if (newUrl !== prevUrl) {
        tauri.setOrthancUrl(host, port);
        setNeedsReload(true);
      }
      // Persist report settings to localStorage
      localStorage.setItem('ukubona_report_settings', JSON.stringify(reportSettings));
      await tauri.saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Save settings failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = async () => {
    await tauri.runCleanup(settings.orthanc.max_studies);
    const stats = await tauri.getStorageStats().catch(() => null);
    if (stats) setStorageStats(stats);
  };

  const set = (path: string[], value: unknown) => {
    setSettings(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as tauri.AppSettings;
      let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
      for (let i = 0; i < path.length - 1; i++) {
        obj = (obj[path[i]] as Record<string, unknown>) ?? {};
      }
      obj[path[path.length - 1]] = value;
      return next;
    });
  };

  const tabLabel = TABS.find(t => t.id === tab)?.label ?? '';

  const wrapperClass = standalone
    ? 'flex h-screen w-full bg-[#0d1117]'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm';
  const panelClass = standalone
    ? 'flex h-full w-full bg-[#111827] overflow-hidden'
    : 'flex h-[80vh] w-full max-w-3xl rounded-2xl bg-[#111827] shadow-2xl border border-white/5 overflow-hidden';

  return (
    <div
      className={wrapperClass}
      onClick={e => !standalone && e.target === e.currentTarget && onClose()}
    >
      <div className={panelClass}>
        {/* Sidebar */}
        <div className="flex w-44 flex-col border-r border-white/5 bg-[#0d1117] py-4">
          <p className="px-4 pb-3 text-xs font-semibold uppercase tracking-wider text-[#4a5568]">
            Settings
          </p>
          {TABS.map(t => {
            const TabIcon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  'flex items-center gap-2.5 px-4 py-2.5 text-sm transition',
                  tab === t.id
                    ? 'bg-[#1a2035] text-white font-medium'
                    : 'text-[#718096] hover:bg-[#1a2035]/50 hover:text-[#a0aec0]',
                ].join(' ')}
              >
                <TabIcon className="w-4 h-4 flex-shrink-0" />
                {t.label}
              </button>
            );
          })}

          <div className="mt-auto px-4 py-2">
            {orthancStatus && (
              <div className="flex items-center gap-1.5 text-xs text-[#4a5568]">
                <div className={`h-1.5 w-1.5 rounded-full ${orthancStatus.running ? 'bg-green-500' : 'bg-red-500'}`} />
                Orthanc {orthancStatus.running ? 'online' : 'offline'}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
            <h2 className="text-base font-semibold text-white">{tabLabel}</h2>
            <div className="flex items-center gap-2">
              {saved && (
                <span className="rounded-lg bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400">
                  Saved
                </span>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-[#63b3ed] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#4299e1] disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-[#718096] hover:bg-white/5 hover:text-white"
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Reload banner */}
          {needsReload && (
            <div className="flex items-center justify-between border-b border-yellow-500/20 bg-yellow-500/10 px-6 py-2">
              <span className="text-xs text-yellow-400">Orthanc URL changed -- reload required to reconnect.</span>
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-300 hover:bg-yellow-500/30"
              >
                Reload now
              </button>
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#63b3ed] border-t-transparent" />
              </div>
            ) : (
              <>
                {tab === 'pacs' && (
                  <>
                    <PacsTab settings={settings} onChange={(k, v) => set(['pacs', k], v)} />
                    <div className="mt-6 border-t border-white/5 pt-6">
                      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-[#718096]">
                        Connect & Query
                      </p>
                      <PacsConnector />
                    </div>
                  </>
                )}
                {tab === 'orthanc' && (
                  <OrthancTab
                    settings={settings}
                    onChange={(k, v) => set(['orthanc', k], v)}
                    onCleanup={handleCleanup}
                  />
                )}
                {tab === 'storage' && (
                  <StorageTab stats={storageStats} />
                )}
                {tab === 'credits' && (
                  <CreditsTab />
                )}
                {tab === 'reports' && (
                  <ReportsTab
                    reportSettings={reportSettings}
                    onChange={setReportSettings}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#718096]">{label}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-[#a0aec0]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'rounded-lg border border-white/5 bg-[#1a2035] px-3 py-2 text-sm text-white placeholder-[#4a5568] outline-none focus:border-[#63b3ed]/50 focus:ring-1 focus:ring-[#63b3ed]/30';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#1a2035] p-4 border border-white/5">
      <p className="text-xs text-[#718096]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out',
        checked ? 'bg-[#63b3ed]' : 'bg-[#2d3748]',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out',
          checked ? 'translate-x-[22px] mt-0.5 ml-0' : 'translate-x-0.5 mt-0.5',
        ].join(' ')}
      />
    </button>
  );
}

// ─── Tab Components ───────────────────────────────────────────────────────────

function PacsTab({
  settings,
  onChange,
}: {
  settings: tauri.AppSettings;
  onChange: (key: string, value: unknown) => void;
}) {
  const pacs = settings.pacs ?? { ae_title: '', host: '', port: 104 };

  return (
    <FieldGroup label="Remote PACS Connection">
      <Field label="AE Title">
        <input
          type="text"
          className={inputClass}
          value={pacs.ae_title}
          onChange={e => onChange('ae_title', e.target.value)}
          placeholder="REMOTE_AE"
        />
      </Field>
      <Field label="Host / IP">
        <input
          type="text"
          className={inputClass}
          value={pacs.host}
          onChange={e => onChange('host', e.target.value)}
          placeholder="192.168.1.100"
        />
      </Field>
      <Field label="Port">
        <input
          type="number"
          className={inputClass}
          value={pacs.port}
          onChange={e => onChange('port', Number(e.target.value))}
          placeholder="104"
          min={1}
          max={65535}
        />
      </Field>
    </FieldGroup>
  );
}

function OrthancTab({
  settings,
  onChange,
  onCleanup,
}: {
  settings: tauri.AppSettings;
  onChange: (key: string, value: unknown) => void;
  onCleanup: () => void;
}) {
  const host = settings.orthanc.host ?? '127.0.0.1';
  const port = settings.orthanc.port ?? 8042;
  const previewUrl = `http://${host}:${port}`;

  return (
    <>
      <FieldGroup label="Connection">
        <Field label="Host / IP">
          <input
            type="text"
            className={inputClass}
            value={host}
            onChange={e => onChange('host', e.target.value)}
            placeholder="127.0.0.1"
          />
        </Field>
        <Field label="Port">
          <input
            type="number"
            className={inputClass}
            value={port}
            onChange={e => onChange('port', Number(e.target.value))}
            min={1}
            max={65535}
            placeholder="8042"
          />
        </Field>
        <div className="rounded-lg bg-[#0d1117] px-3 py-2 font-mono text-xs text-[#4a5568]">
          {previewUrl}/dicom-web
        </div>
      </FieldGroup>

      <FieldGroup label="Cache Settings">
        <Field label="Max Studies in Orthanc Cache">
          <input
            type="number"
            className={inputClass}
            value={settings.orthanc.max_studies ?? 30}
            onChange={e => onChange('max_studies', Number(e.target.value))}
            min={1}
            max={500}
          />
        </Field>
      </FieldGroup>
      <div>
        <p className="mb-2 text-xs text-[#718096]">
          Enforce the limit now by removing least recently used studies from Orthanc.
          Local files are not deleted.
        </p>
        <button
          onClick={onCleanup}
          className="rounded-lg bg-[#1a2035] px-4 py-2 text-sm text-[#a0aec0] border border-white/5 hover:bg-[#2d3748] hover:text-white"
        >
          Run Cleanup Now
        </button>
      </div>
    </>
  );
}

function StorageTab({ stats }: { stats: tauri.StorageStats | null }) {
  if (!stats) return <p className="text-sm text-[#718096]">Loading storage info...</p>;

  const gb = (stats.total_bytes / 1e9).toFixed(2);
  const mb = (stats.total_bytes / 1e6).toFixed(0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Studies Stored" value={String(stats.study_count)} />
        <StatCard
          label="Total Size"
          value={stats.total_bytes > 1e9 ? `${gb} GB` : `${mb} MB`}
        />
      </div>
      <div className="rounded-xl bg-[#1a2035] p-4">
        <p className="mb-1 text-xs text-[#718096]">Storage Directory</p>
        <p className="break-all font-mono text-xs text-[#a0aec0]">{stats.studies_dir}</p>
      </div>
    </div>
  );
}

function CreditsTab() {
  const available = 247;
  const total = 500;
  const used = total - available;
  const pct = Math.round((used / total) * 100);

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup label="Credit Balance">
        <div className="rounded-xl bg-[#1a2035] p-6 border border-white/5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-[#718096] mb-1">Available Credits</p>
              <p className="text-4xl font-bold text-white">{available}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#718096] mb-1">Total</p>
              <p className="text-lg font-semibold text-[#a0aec0]">{total}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[#718096]">Usage</span>
              <span className="text-xs text-[#718096]">{pct}% used</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#0d1117]">
              <div
                className="h-2 rounded-full bg-[#63b3ed] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </FieldGroup>

      <FieldGroup label="Plan">
        <div className="rounded-xl bg-[#1a2035] p-4 border border-white/5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Professional</p>
            <p className="text-xs text-[#718096] mt-0.5">500 credits / billing cycle</p>
          </div>
          <span className="rounded-full bg-[#63b3ed]/15 px-3 py-1 text-xs font-medium text-[#63b3ed]">
            Active
          </span>
        </div>
      </FieldGroup>

      <div>
        <button
          onClick={() => console.log('Purchase credits clicked')}
          className="rounded-lg bg-[#63b3ed] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#4299e1] transition"
        >
          Purchase Credits
        </button>
      </div>

      <FieldGroup label="Usage History">
        <div className="rounded-xl bg-[#1a2035] p-6 border border-white/5 flex items-center justify-center">
          <p className="text-sm text-[#4a5568]">Coming soon</p>
        </div>
      </FieldGroup>
    </div>
  );
}

function ReportsTab({
  reportSettings,
  onChange,
}: {
  reportSettings: ReportSettings;
  onChange: (next: ReportSettings) => void;
}) {
  const update = (patch: Partial<ReportSettings>) => {
    onChange({ ...reportSettings, ...patch });
  };

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup label="Auto-Save">
        <div className="flex items-center justify-between rounded-xl bg-[#1a2035] p-4 border border-white/5">
          <div>
            <p className="text-sm text-white">Enable Auto-Save</p>
            <p className="text-xs text-[#718096] mt-0.5">Automatically save reports while editing</p>
          </div>
          <ToggleSwitch
            checked={reportSettings.autoSave}
            onChange={val => update({ autoSave: val })}
          />
        </div>

        <Field label="Auto-save interval (seconds)">
          <input
            type="number"
            className={inputClass}
            value={reportSettings.autoSaveInterval}
            onChange={e => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= 30) update({ autoSaveInterval: v });
            }}
            min={1}
            max={30}
            disabled={!reportSettings.autoSave}
          />
        </Field>
      </FieldGroup>

      <FieldGroup label="Cloud Sync">
        <div className="flex items-center justify-between rounded-xl bg-[#1a2035] p-4 border border-white/5">
          <div>
            <p className="text-sm text-white">Save reports to cloud</p>
            <p className="text-xs text-[#718096] mt-0.5">Sync completed reports to your cloud storage</p>
          </div>
          <ToggleSwitch
            checked={reportSettings.cloudSync}
            onChange={val => update({ cloudSync: val })}
          />
        </div>
      </FieldGroup>
    </div>
  );
}
