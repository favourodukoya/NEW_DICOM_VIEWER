import React, { useState, useEffect, useRef } from 'react';
import * as tauri from '../tauriBridge';
import { openTauriWindow } from '../tauriBridge';

interface PacsModalProps {
  onClose: () => void;
  onStudyRetrieved?: () => void;
  onOpenSettings: () => void;
}

const RECENT_PACS_KEY = 'ukubona_recent_pacs';
const MAX_RECENT = 5;

interface RecentPacs extends tauri.PacsConfig {
  label?: string; // optional friendly name
  last_used: number; // timestamp ms
}

function loadRecentPacs(): RecentPacs[] {
  try { return JSON.parse(localStorage.getItem(RECENT_PACS_KEY) || '[]'); } catch { return []; }
}
function saveRecentPacs(list: RecentPacs[]) {
  try { localStorage.setItem(RECENT_PACS_KEY, JSON.stringify(list)); } catch {}
}
function pushRecentPacs(cfg: tauri.PacsConfig) {
  const list = loadRecentPacs().filter(
    r => !(r.host === cfg.host && r.port === cfg.port && r.ae_title === cfg.ae_title)
  );
  list.unshift({ ...cfg, last_used: Date.now() });
  saveRecentPacs(list.slice(0, MAX_RECENT));
}

export default function PacsModal({ onClose, onOpenSettings }: PacsModalProps) {
  const [config, setConfig] = useState<tauri.PacsConfig>({ ae_title: '', host: '', port: 104 });
  const [query, setQuery] = useState<tauri.PacsQuery>({ patient_name: '', description: '', date_range: '', modality: '' });
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentPacs, setRecentPacs] = useState<RecentPacs[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load saved PACS config from settings and recent list on mount
  useEffect(() => {
    setRecentPacs(loadRecentPacs());
    if (!tauri.isTauri()) return;
    tauri.getSettings().then(s => {
      if (s.pacs) setConfig(s.pacs);
    }).catch(() => {});
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleQuery = async () => {
    if (!config.ae_title || !config.host) {
      setError('AE Title and Host are required');
      return;
    }
    setQuerying(true);
    setError(null);
    try {
      const studies = await tauri.queryPacs(config, {
        patient_name: query.patient_name || undefined,
        description: query.description || undefined,
        date_range: query.date_range || undefined,
        modality: query.modality || undefined,
      });
      if (studies.length === 0) {
        setError('No studies found matching your query.');
        return;
      }
      // Save to recent list
      pushRecentPacs(config);
      setRecentPacs(loadRecentPacs());
      // Store results and open dedicated window
      try {
        localStorage.setItem('ukubona_pacs_results', JSON.stringify({ studies, config }));
      } catch { /* storage full */ }
      await openTauriWindow('pacs_results', {
        url: '/pacs-study-list',
        title: 'Studies from PACS',
        width: 1100,
        height: 700,
        minWidth: 800,
        minHeight: 500,
        center: true,
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setQuerying(false);
    }
  };

  const removeRecent = (idx: number) => {
    const next = recentPacs.filter((_, i) => i !== idx);
    setRecentPacs(next);
    saveRecentPacs(next);
  };

  const inp = 'w-full rounded-lg border border-[#1e2433] bg-[#0d1117] px-3 py-2 text-sm text-white placeholder-[#4b5563] outline-none focus:border-[#3b82f6]/60 transition';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={e => e.target === e.currentTarget && onClose()}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative z-10 flex w-full max-w-xl flex-col bg-[#0d1117] shadow-2xl border-l border-[#1e2433]"
        style={{ animation: 'slideInRight 0.18s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1e2433] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3b82f6]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
                <circle cx="9" cy="10" r="2" />
                <path d="M13 8h4M13 12h4" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Load from PACS</h2>
              <p className="text-[11px] text-[#4b5563]">Query &amp; retrieve studies from a remote PACS server</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenSettings}
              title="PACS Settings"
              className="flex items-center gap-1.5 rounded-lg border border-[#1e2433] bg-[#161b26] px-2.5 py-1.5 text-xs text-[#9ca3af] transition hover:border-[#3b82f6]/40 hover:text-white"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
              PACS Settings
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-[#4b5563] hover:bg-white/5 hover:text-white transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Recent PACS servers */}
          {recentPacs.length > 0 && (
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Recent Servers</p>
              <div className="flex flex-col gap-1">
                {recentPacs.map((r, i) => (
                  <div key={i} className="group flex items-center gap-2 rounded-lg border border-[#1e2433] bg-[#161b26] px-3 py-2 hover:border-[#2a3040] transition">
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => setConfig({ ae_title: r.ae_title, host: r.host, port: r.port })}
                    >
                      <p className="truncate text-xs font-medium text-[#d1d5db]">
                        {r.ae_title} <span className="text-[#4b5563]">·</span> {r.host}:{r.port}
                      </p>
                      <p className="text-[10px] text-[#4b5563]">
                        {new Date(r.last_used).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </button>
                    <button
                      onClick={() => removeRecent(i)}
                      className="flex-shrink-0 rounded p-1 text-[#374151] opacity-0 group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400 transition"
                      title="Remove from recent"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Connection */}
          <section>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Connection</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6b7280]">AE Title</label>
                <input className={inp} value={config.ae_title}
                  onChange={e => setConfig(c => ({ ...c, ae_title: e.target.value }))}
                  placeholder="REMOTE_PACS" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6b7280]">Host / IP</label>
                <input className={inp} value={config.host}
                  onChange={e => setConfig(c => ({ ...c, host: e.target.value }))}
                  placeholder="192.168.1.100" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6b7280]">Port</label>
                <input type="number" className={inp} value={config.port}
                  onChange={e => setConfig(c => ({ ...c, port: Number(e.target.value) }))}
                  placeholder="104" />
              </div>
            </div>
          </section>

          {/* Query */}
          <section>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Query</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6b7280]">Patient Name</label>
                <input className={inp} value={query.patient_name}
                  onChange={e => setQuery(q => ({ ...q, patient_name: e.target.value }))}
                  placeholder="Smith* (wildcards ok)" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6b7280]">Study Description</label>
                <input className={inp} value={query.description}
                  onChange={e => setQuery(q => ({ ...q, description: e.target.value }))}
                  placeholder="Chest*" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6b7280]">Date Range</label>
                <input className={inp} value={query.date_range}
                  onChange={e => setQuery(q => ({ ...q, date_range: e.target.value }))}
                  placeholder="20240101-20241231" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#6b7280]">Modality</label>
                <input className={inp} value={query.modality}
                  onChange={e => setQuery(q => ({ ...q, modality: e.target.value }))}
                  placeholder="CT" />
              </div>
            </div>
            <button
              onClick={handleQuery}
              disabled={querying}
              className="mt-3 flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2563eb] disabled:opacity-50"
            >
              {querying ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Querying PACS...
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Search PACS
                </>
              )}
            </button>
          </section>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
              <svg className="mt-0.5 flex-shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
