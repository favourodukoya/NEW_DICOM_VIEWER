/**
 * PacsStudyList — standalone page shown in a new Tauri window.
 * Reads results from localStorage key 'ukubona_pacs_results',
 * displays them as a paginated table, and lets the user:
 *   - View: opens the study directly (retrieve + open in one step)
 *   - Retrieve: C-MOVE the study into local Orthanc for offline access
 * Clicking a study row shows mode-selection options (Basic, Segmentation, MPR/3D, etc.).
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as tauri from '../tauriBridge';
import { getApplicableModes, ViewerMode } from './ModeSelectModal';

const PAGE_SIZE = 25;

function formatDate(d?: string) {
  if (!d) return '—';
  const c = d.replace(/\D/g, '');
  if (c.length === 8) return `${c.slice(6, 8)}/${c.slice(4, 6)}/${c.slice(0, 4)}`;
  return d;
}

type StudyAction = 'idle' | 'retrieving' | 'retrieved' | 'viewing';

export default function PacsStudyList() {
  const [results, setResults] = useState<tauri.PacsStudy[]>([]);
  const [config, setConfig] = useState<tauri.PacsConfig | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [studyStatus, setStudyStatus] = useState<Map<string, StudyAction>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [batchRetrieving, setBatchRetrieving] = useState(false);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ukubona_pacs_results');
      if (raw) {
        const data = JSON.parse(raw);
        setResults(data.studies ?? []);
        setConfig(data.config ?? null);
      }
    } catch { /* ignore */ }
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return results;
    const q = search.toLowerCase();
    return results.filter(s =>
      (s.patient_name || '').toLowerCase().includes(q) ||
      (s.study_description || '').toLowerCase().includes(q) ||
      (s.modality || '').toLowerCase().includes(q) ||
      (s.study_date || '').includes(q)
    );
  }, [results, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search]);

  const getStatus = (uid: string): StudyAction => studyStatus.get(uid) || 'idle';
  const setStatus = (uid: string, status: StudyAction) =>
    setStudyStatus(prev => new Map(prev).set(uid, status));

  const toggleSelect = (uid: string) => {
    if (!uid) return;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const toggleAll = () => {
    const pageUids = pageItems
      .map(s => s.study_instance_uid)
      .filter(u => u && getStatus(u) !== 'retrieving');
    const allSelected = pageUids.length > 0 && pageUids.every(u => selected.has(u));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) pageUids.forEach(u => next.delete(u));
      else pageUids.forEach(u => next.add(u));
      return next;
    });
  };

  // Retrieve studies into local Orthanc (C-MOVE)
  const handleRetrieve = useCallback(async (uids: string[], openFirst = false) => {
    if (!config) return;
    setError(null);
    uids.forEach(uid => setStatus(uid, 'retrieving'));
    const succeeded: string[] = [];
    for (const uid of uids) {
      try {
        await tauri.retrieveFromPacs(config, uid);
        setStatus(uid, 'retrieved');
        setSelected(prev => { const n = new Set(prev); n.delete(uid); return n; });
        succeeded.push(uid);
      } catch (e) {
        setStatus(uid, 'idle');
        setError(`Failed: ${uid.slice(-12)}: ${String(e)}`);
      }
    }
    setBatchRetrieving(false);
    // Notify main window
    if (succeeded.length > 0) {
      try {
        const bc = new BroadcastChannel('ukubona_refresh');
        if (openFirst) {
          bc.postMessage({ action: 'open_ephemeral', studyUid: succeeded[0] });
          if (succeeded.length > 1) {
            bc.postMessage({ action: 'mark_ephemeral', studyUids: succeeded.slice(1) });
          }
        } else {
          bc.postMessage({ action: 'mark_ephemeral', studyUids: succeeded });
          bc.postMessage({ action: 'refresh' });
        }
        bc.close();
      } catch { /* ignore */ }
    }
  }, [config]);

  // View study: retrieve + open in viewer
  const handleView = useCallback(async (study: tauri.PacsStudy, mode: ViewerMode) => {
    if (!config) return;
    setError(null);
    const uid = study.study_instance_uid;
    setStatus(uid, 'viewing');
    setExpandedUid(null);
    try {
      await tauri.retrieveFromPacs(config, uid);
      setStatus(uid, 'retrieved');
      // Open in main window via BroadcastChannel
      try {
        const bc = new BroadcastChannel('ukubona_refresh');
        bc.postMessage({
          action: 'open_pacs_study',
          studyUid: uid,
          route: mode.route,
          dataPath: mode.dataPath,
          extraParams: mode.extraParams || '',
        });
        bc.close();
      } catch { /* ignore */ }
    } catch (e) {
      setStatus(uid, 'idle');
      setError(`Failed to load study: ${String(e)}`);
    }
  }, [config]);

  const modalities = useMemo(() => {
    const mods = new Set(results.map(s => s.modality).filter(Boolean));
    return ['All', ...Array.from(mods).sort()];
  }, [results]);

  const [modalityFilter, setModalityFilter] = useState('All');
  const displayItems = modalityFilter === 'All'
    ? pageItems
    : pageItems.filter(s => s.modality === modalityFilter);

  const allPageSelectableUids = pageItems
    .map(s => s.study_instance_uid)
    .filter(u => u && getStatus(u) !== 'retrieving' && getStatus(u) !== 'viewing');
  const allPageSelected = allPageSelectableUids.length > 0 &&
    allPageSelectableUids.every(u => selected.has(u));

  return (
    <div className="flex h-screen flex-col bg-[#0d1117] text-white">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[#1e2433] bg-[#0f1117] px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3b82f6]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
                <circle cx="9" cy="10" r="2" />
                <path d="M13 8h4M13 12h3" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">Studies from PACS</h1>
              {config && (
                <p className="text-[11px] text-[#4b5563]">
                  {config.ae_title} · {config.host}:{config.port} · {results.length} studies found
                </p>
              )}
            </div>
          </div>

          {/* Batch retrieve */}
          {selected.size > 0 && (
            <button
              onClick={() => { setBatchRetrieving(true); handleRetrieve([...selected]); }}
              disabled={batchRetrieving}
              className="flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2563eb] disabled:opacity-60"
            >
              {batchRetrieving ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
              Retrieve {selected.size} selected
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 border-b border-[#1e2433] bg-[#0d1117] px-6 py-2.5">
        {/* Search */}
        <div className="relative max-w-xs flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#4b5563]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by name, description, modality..."
            className="w-full rounded-lg border border-[#1e2433] bg-[#161b26] py-1.5 pl-8 pr-3 text-xs text-white placeholder-[#4b5563] outline-none focus:border-[#3b82f6]/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-white">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>

        {/* Modality filter pills */}
        <div className="flex flex-wrap items-center gap-1">
          {modalities.map(m => (
            <button
              key={m}
              onClick={() => setModalityFilter(m)}
              className={[
                'rounded-md px-2 py-0.5 text-[11px] transition',
                modalityFilter === m
                  ? 'bg-[#3b82f6]/15 font-medium text-[#60a5fa]'
                  : 'text-[#6b7280] hover:text-[#d1d5db]',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="ml-auto text-[11px] text-[#4b5563]">
          {filtered.length} {filtered.length === 1 ? 'study' : 'studies'}
          {search ? ` matching "${search}"` : ''}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex-shrink-0 mx-6 mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <svg className="mt-0.5 flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
          <button onClick={() => setError(null)} className="ml-auto opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-20 text-[#4b5563]">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
            <p className="text-sm">No results loaded. Close this window and query again.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#1e2433]">
                <th className="w-10 pb-2 text-left">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded accent-[#3b82f6]"
                  />
                </th>
                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Patient</th>
                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Description</th>
                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Modality</th>
                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Date</th>
                <th className="w-48 pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Action</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((study, i) => {
                const uid = study.study_instance_uid;
                const status = getStatus(uid);
                const isSelected = uid ? selected.has(uid) : false;
                const isExpanded = expandedUid === uid;
                const modes = getApplicableModes(study.modality);
                return (
                  <React.Fragment key={uid || i}>
                    <tr
                      onClick={() => {
                        if (status === 'retrieving' || status === 'viewing') return;
                        // Toggle expanded row on click
                        setExpandedUid(prev => prev === uid ? null : uid);
                      }}
                      className={[
                        'group cursor-pointer border-b border-[#1e2433] transition-colors',
                        status === 'retrieved' ? 'bg-emerald-500/5' :
                        status === 'viewing' ? 'bg-[#8b5cf6]/5' :
                        isSelected ? 'bg-[#3b82f6]/8' :
                        isExpanded ? 'bg-[#161b26]' :
                        i % 2 === 0 ? 'bg-transparent hover:bg-[#161b26]' : 'bg-[#0f1117] hover:bg-[#161b26]',
                      ].join(' ')}
                    >
                      <td className="py-2.5 pr-3" onClick={e => e.stopPropagation()}>
                        {status === 'retrieved' ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(uid)}
                            className="h-3.5 w-3.5 rounded accent-[#3b82f6]"
                            disabled={status === 'retrieving' || status === 'viewing'}
                          />
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="font-medium text-[#e5e7eb]">{study.patient_name || '—'}</div>
                        {uid && <div className="mt-0.5 font-mono text-[10px] text-[#374151]">{uid.slice(-16)}</div>}
                      </td>
                      <td className="py-2.5 pr-4 text-[#9ca3af]">{study.study_description || '—'}</td>
                      <td className="py-2.5 pr-4">
                        {study.modality ? (
                          <span className="rounded-md bg-[#1e2433] px-1.5 py-0.5 text-[10px] font-semibold text-[#9ca3af]">{study.modality}</span>
                        ) : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-[#9ca3af]">{formatDate(study.study_date)}</td>
                      <td className="py-2.5 text-right" onClick={e => e.stopPropagation()}>
                        {status === 'retrieving' ? (
                          <span className="flex items-center justify-end gap-1.5 text-[11px] text-[#60a5fa]">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#60a5fa] border-t-transparent" />
                            Retrieving...
                          </span>
                        ) : status === 'viewing' ? (
                          <span className="flex items-center justify-end gap-1.5 text-[11px] text-[#8b5cf6]">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#8b5cf6] border-t-transparent" />
                            Loading...
                          </span>
                        ) : status === 'retrieved' ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                try {
                                  const bc = new BroadcastChannel('ukubona_refresh');
                                  bc.postMessage({ action: 'open_ephemeral', studyUid: uid });
                                  bc.close();
                                } catch { /* ignore */ }
                              }}
                              className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition"
                              title="Open in viewer"
                            >
                              Open
                            </button>
                            <span className="text-[10px] text-emerald-500/60">Retrieved</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Quick view — retrieve + open in basic viewer */}
                            <button
                              onClick={() => handleView(study, modes[0])}
                              className="rounded-lg bg-[#3b82f6]/10 px-2.5 py-1 text-[11px] font-medium text-[#60a5fa] transition hover:bg-[#3b82f6]/20"
                              title="Retrieve and open in viewer"
                            >
                              View
                            </button>
                            {/* Retrieve only — download to local Orthanc */}
                            <button
                              onClick={() => handleRetrieve([uid])}
                              className="rounded-lg border border-[#1e2433] bg-[#161b26] px-2.5 py-1 text-[11px] text-[#9ca3af] transition hover:border-[#3b82f6]/40 hover:text-white"
                              title="Retrieve to local storage"
                            >
                              Retrieve
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* Expanded row: mode selection */}
                    {isExpanded && status !== 'retrieving' && status !== 'viewing' && (
                      <tr className="border-b border-[#1e2433]">
                        <td colSpan={6} className="bg-[#0f1117] px-6 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[#4b5563] mr-2">Open as:</span>
                            {modes.map(mode => (
                              <button
                                key={mode.id}
                                onClick={() => handleView(study, mode)}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition"
                                style={{
                                  backgroundColor: `${mode.color}12`,
                                  color: mode.color,
                                  border: `1px solid ${mode.color}25`,
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.backgroundColor = `${mode.color}22`;
                                  e.currentTarget.style.borderColor = `${mode.color}50`;
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.backgroundColor = `${mode.color}12`;
                                  e.currentTarget.style.borderColor = `${mode.color}25`;
                                }}
                                title={mode.description}
                              >
                                <span className="flex h-4 w-4 items-center justify-center" style={{ color: mode.color }}>
                                  {mode.icon}
                                </span>
                                {mode.shortLabel}
                              </button>
                            ))}
                            <div className="ml-auto flex items-center gap-1.5">
                              <button
                                onClick={() => handleRetrieve([uid])}
                                disabled={status === 'retrieved'}
                                className="rounded-lg border border-[#1e2433] bg-[#161b26] px-2.5 py-1 text-[11px] text-[#6b7280] transition hover:border-[#3b82f6]/40 hover:text-white disabled:opacity-40"
                              >
                                {status === 'retrieved' ? 'Already Retrieved' : 'Retrieve Only'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex-shrink-0 flex items-center justify-between border-t border-[#1e2433] px-6 py-3">
          <span className="text-[11px] text-[#4b5563]">
            Page {page + 1} of {pageCount} · showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="rounded-md px-2 py-1 text-xs text-[#6b7280] transition hover:bg-[#161b26] hover:text-white disabled:opacity-30"
            >&laquo;</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md px-2 py-1 text-xs text-[#6b7280] transition hover:bg-[#161b26] hover:text-white disabled:opacity-30"
            >&lsaquo; Prev</button>
            {Array.from({ length: Math.min(7, pageCount) }, (_, i) => {
              const offset = Math.max(0, Math.min(page - 3, pageCount - 7));
              const p = i + offset;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={[
                    'min-w-[28px] rounded-md px-2 py-1 text-xs transition',
                    p === page
                      ? 'bg-[#3b82f6]/15 font-semibold text-[#60a5fa]'
                      : 'text-[#6b7280] hover:bg-[#161b26] hover:text-white',
                  ].join(' ')}
                >
                  {p + 1}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="rounded-md px-2 py-1 text-xs text-[#6b7280] transition hover:bg-[#161b26] hover:text-white disabled:opacity-30"
            >Next &rsaquo;</button>
            <button
              onClick={() => setPage(pageCount - 1)}
              disabled={page >= pageCount - 1}
              className="rounded-md px-2 py-1 text-xs text-[#6b7280] transition hover:bg-[#161b26] hover:text-white disabled:opacity-30"
            >&raquo;</button>
          </div>
        </div>
      )}
    </div>
  );
}
