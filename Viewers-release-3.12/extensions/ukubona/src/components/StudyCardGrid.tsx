import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StudyCard from './StudyCard';
import LoginPage, { isAuthenticated, clearSession } from './LoginPage';
import ModeSelectModal, { getApplicableModes, ViewerMode } from './ModeSelectModal';
import * as tauri from '../tauriBridge';

interface StudyCardGridProps {
  dataPath?: string;
}

interface StudyItem {
  studyInstanceUid: string;
  patientName: string;
  patientId: string;
  studyDescription: string;
  studyDate: string;
  modalities: string;
  seriesCount: number;
  instanceCount: number;
  orthancId: string;
}

type ModalityFilter = string;
const MODALITY_FILTERS: string[] = ['ALL', 'CT', 'MR', 'CR', 'DX', 'US', 'PT', 'MG', 'NM', 'OB', 'XA', 'RF', 'SC', 'OT'];

export default function StudyCardGrid({ dataPath = '/orthanc' }: StudyCardGridProps) {
  const [authed, setAuthed] = useState(() => isAuthenticated());
  const [studies, setStudies] = useState<StudyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [orthancOnline, setOrthancOnline] = useState(false);
  const [loadingStudy, setLoadingStudy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalityFilter, setModalityFilter] = useState<ModalityFilter>('ALL');
  const [dragging, setDragging] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<Array<{
    id: string; name: string; status: 'uploading' | 'success' | 'error'; error?: string;
  }>>([]);
  const [modeModal, setModeModal] = useState<StudyItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<StudyItem | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutHasWindows, setLogoutHasWindows] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // ── Fetch studies ───────────────────────────────────────────────────────────
  const fetchStudies = useCallback(async () => {
    setLoading(true);
    try {
      if (tauri.isTauri()) {
        const status = await tauri.getOrthancStatus();
        setOrthancOnline(status.running);
        const data = await tauri.getStudies();
        const mapped = data.map(s => ({
          studyInstanceUid: s.study_instance_uid,
          patientName: s.patient_name,
          patientId: s.patient_id,
          studyDescription: s.study_description,
          studyDate: s.study_date,
          modalities: s.modalities,
          seriesCount: s.series_count,
          instanceCount: s.instance_count,
          orthancId: s.orthanc_id,
        }));
        // Enrich missing modalities from Orthanc REST API
        const ORTHANC = tauri.getOrthancBase();
        await Promise.all(
          mapped
            .filter(s => !s.modalities && s.orthancId)
            .map(async study => {
              try {
                const meta = await fetch(
                  `${ORTHANC}/studies/${study.orthancId}?requestedTags=ModalitiesInStudy`
                ).then(r => r.json());
                let mods: string =
                  meta.MainDicomTags?.ModalitiesInStudy ||
                  meta.RequestedTags?.ModalitiesInStudy ||
                  '';
                if (!mods && Array.isArray(meta.Series) && meta.Series.length > 0) {
                  const seriesMods = await Promise.all(
                    meta.Series.slice(0, 5).map((sid: string) =>
                      fetch(`${ORTHANC}/series/${sid}`)
                        .then(r => r.json())
                        .then(s => (s.MainDicomTags?.Modality as string) || '')
                        .catch(() => '')
                    )
                  );
                  mods = [...new Set(seriesMods.filter(Boolean))].join('\\');
                }
                if (mods) study.modalities = mods;
              } catch { /* ignore, modality stays empty */ }
            })
        );
        setStudies(mapped);
      } else {
        const fallback = await fetchFromOrthancDirect();
        setStudies(fallback);
        setOrthancOnline(true);
      }
    } catch {
      try {
        const fallback = await fetchFromOrthancDirect();
        setStudies(fallback);
        setOrthancOnline(true);
      } catch {
        setOrthancOnline(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) fetchStudies();
  }, [authed, fetchStudies]);

  // Clear viewer-active state and restore default title when study list is shown
  useEffect(() => {
    try { localStorage.removeItem('ukubona_viewer_active'); } catch {}
    document.title = 'Ukubona DICOM Viewer';
    if (tauri.isTauri()) {
      (window as any).__TAURI_INTERNALS__?.invoke('plugin:window|set_title', {
        label: 'main', title: 'Ukubona DICOM Viewer',
      }).catch(() => {});
    }
  }, []);

  // ── Study open logic ────────────────────────────────────────────────────────
  const openStudy = useCallback(async (study: StudyItem, mode: ViewerMode) => {
    setLoadingStudy(study.studyInstanceUid);
    // Track viewer-active state so report/AI windows can detect it
    try {
      localStorage.setItem('ukubona_viewer_active', JSON.stringify({
        uid: study.studyInstanceUid, patientName: study.patientName, ts: Date.now(),
      }));
    } catch {}
    // Update window title
    const titleParts = [study.modalities, study.patientName].filter(Boolean);
    const title = titleParts.length > 0
      ? `${titleParts.join(' \u00B7 ')} \u2014 Ukubona`
      : 'Ukubona Viewer';
    document.title = title;
    if (tauri.isTauri()) {
      (window as any).__TAURI_INTERNALS__?.invoke('plugin:window|set_title', { label: 'main', title }).catch(() => {});
    }
    try {
      if (tauri.isTauri()) {
        const inOrthanc = await tauri.checkStudyInOrthanc(study.studyInstanceUid).catch(() => true);
        if (!inOrthanc) await tauri.importStudyToOrthanc(study.studyInstanceUid);
      }
      navigate(`/${mode.route}${mode.dataPath}?StudyInstanceUIDs=${study.studyInstanceUid}`);
    } catch {
      navigate(`/${mode.route}${dataPath}?StudyInstanceUIDs=${study.studyInstanceUid}`);
    } finally {
      setLoadingStudy(null);
    }
  }, [navigate, dataPath]);

  const handleStudyClick = useCallback((study: StudyItem) => {
    const modes = getApplicableModes(study.modalities);
    if (modes.length === 1) {
      openStudy(study, modes[0]);
    } else {
      setModeModal(study);
    }
  }, [openStudy]);

  // Check for pending study nav set by preRegistration global BC handler (viewer→root transition)
  useEffect(() => {
    if (studies.length === 0) return;
    try {
      const pending = localStorage.getItem('ukubona_pending_view');
      if (pending) {
        localStorage.removeItem('ukubona_pending_view');
        const study = studies.find(s => s.studyInstanceUid === pending);
        if (study) handleStudyClick(study);
        else navigate(`/basic/orthanc?StudyInstanceUIDs=${pending}`);
      }
    } catch {}
  }, [studies, handleStudyClick, navigate]);

  // Listen for cross-window navigation (BC from report/AI windows when already on study list)
  // and custom events dispatched by the preRegistration handler
  useEffect(() => {
    const bc = new BroadcastChannel('ukubona_nav');
    bc.onmessage = (e) => {
      if (e.data?.action === 'view_study' && e.data?.uid) {
        const study = studies.find(s => s.studyInstanceUid === e.data.uid);
        if (study) handleStudyClick(study);
        else navigate(`/basic/orthanc?StudyInstanceUIDs=${e.data.uid}`);
      }
    };
    const handleNavEvent = (e: Event) => {
      const uid = (e as CustomEvent).detail?.uid as string | undefined;
      if (!uid) return;
      const study = studies.find(s => s.studyInstanceUid === uid);
      if (study) handleStudyClick(study);
      else navigate(`/basic/orthanc?StudyInstanceUIDs=${uid}`);
    };
    window.addEventListener('ukubona_navigate', handleNavEvent);
    return () => {
      bc.close();
      window.removeEventListener('ukubona_navigate', handleNavEvent);
    };
  }, [studies, handleStudyClick, navigate]);

  const handleDelete = useCallback((study: StudyItem) => {
    setDeleteConfirm(study);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const study = deleteConfirm;
    setDeleteConfirm(null);
    try {
      if (tauri.isTauri()) {
        await tauri.deleteStudyFromOrthanc(study.orthancId);
      } else {
        await tauri.deleteStudyHttp(study.orthancId);
      }
      setStudies(prev => prev.filter(s => s.orthancId !== study.orthancId));
    } catch (e) {
      console.error('Delete failed:', e);
    }
  }, [deleteConfirm]);

  // ── Report / AI handlers ───────────────────────────────────────────────────
  const handleOpenReport = useCallback(async (study: StudyItem) => {
    if (tauri.isTauri()) {
      const label = `report_${study.studyInstanceUid.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
      await tauri.openTauriWindow(label, {
        url: `/report-manager?uid=${encodeURIComponent(study.studyInstanceUid)}&name=${encodeURIComponent(study.patientName)}&pid=${encodeURIComponent(study.patientId)}&mod=${encodeURIComponent(study.modalities)}&date=${encodeURIComponent(study.studyDate)}`,
        title: `Report — ${study.patientName || 'Study'} — ${study.modalities || study.studyDescription || ''}`,
        width: 560,
        height: 700,
        minWidth: 560,
        minHeight: 500,
      });
    }
  }, []);

  const handleOpenAI = useCallback(async (study: StudyItem) => {
    if (!isAuthenticated()) {
      alert('Please sign in to use Ukubona AI');
      return;
    }
    if (tauri.isTauri()) {
      const label = `ai_${study.studyInstanceUid.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
      await tauri.openTauriWindow(label, {
        url: `/ai-panel?uid=${encodeURIComponent(study.studyInstanceUid)}&name=${encodeURIComponent(study.patientName)}&pid=${encodeURIComponent(study.patientId)}&mod=${encodeURIComponent(study.modalities)}&date=${encodeURIComponent(study.studyDate)}`,
        title: `Ukubona AI — ${study.patientName || 'Study'} — ${study.modalities || ''}`,
        width: 700,
        height: 720,
        minWidth: 560,
        minHeight: 500,
      });
    }
  }, []);

  // ── Settings handler ──────────────────────────────────────────────────────
  const handleOpenSettings = useCallback(async () => {
    if (tauri.isTauri()) {
      await tauri.openTauriWindow('settings_panel', {
        url: '/settings-panel',
        title: 'Ukubona Settings',
        width: 780,
        height: 600,
        minWidth: 640,
        minHeight: 480,
      });
    }
  }, []);

  // ── Upload helpers ──────────────────────────────────────────────────────────
  const addJob = (name: string) => {
    const id = Math.random().toString(36).slice(2);
    setUploadJobs(prev => [...prev, { id, name, status: 'uploading' }]);
    return id;
  };
  const finishJob = (id: string, ok: boolean, err?: string) => {
    setUploadJobs(prev => prev.map(j => j.id === id ? { ...j, status: ok ? 'success' : 'error', error: err } : j));
    if (ok) setTimeout(() => fetchStudies(), 600);
    // Auto-dismiss after 4s
    setTimeout(() => setUploadJobs(prev => prev.filter(j => j.id !== id)), 4000);
  };

  const handleDroppedFiles = useCallback(async (files: File[]) => {
    const zips = files.filter(f => f.name.toLowerCase().endsWith('.zip'));
    const dicoms = files.filter(f => !f.name.toLowerCase().endsWith('.zip'));
    for (const zip of zips) {
      const id = addJob(zip.name);
      try {
        const b64 = await tauri.fileToBase64(zip);
        await tauri.uploadZip(b64, zip.name);
        finishJob(id, true);
      } catch (e) { finishJob(id, false, String(e)); }
    }
    if (dicoms.length > 0) {
      const id = addJob(`${dicoms.length} DICOM file(s)`);
      try {
        const uploads = await Promise.all(dicoms.map(async f => ({ name: f.name, data: await tauri.fileToBase64(f) })));
        await tauri.uploadDicomFiles(uploads);
        finishJob(id, true);
      } catch (e) { finishJob(id, false, String(e)); }
    }
  }, []);

  const handleFolderPick = useCallback(async () => {
    try {
      const path = await tauri.openFolderDialog();
      if (!path) return;
      const id = addJob(`Folder: ${(path as string).split(/[\\/]/).pop()}`);
      try {
        await tauri.uploadFolder(path as string);
        finishJob(id, true);
      } catch (e) { finishJob(id, false, String(e)); }
    } catch (e) { console.error(e); }
  }, []);

  // ── Drag-drop ───────────────────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleDroppedFiles(Array.from(e.dataTransfer.files));
  };

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = studies.filter(s => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      s.patientName.toLowerCase().includes(q) ||
      s.studyDescription.toLowerCase().includes(q) ||
      s.modalities.toLowerCase().includes(q) ||
      s.patientId.toLowerCase().includes(q);
    // Split modalities by backslash, comma, forward slash, or spaces and match filter
    const modsRaw = (s.modalities || '').toUpperCase();
    const studyMods = modsRaw.split(/[\\/,\s]+/).map(m => m.trim()).filter(Boolean);
    const matchesModality = modalityFilter === 'ALL' ||
      studyMods.some(m => m === modalityFilter) ||
      modsRaw.includes(modalityFilter);
    return matchesSearch && matchesModality;
  });

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const activeUploads = uploadJobs.filter(j => j.status === 'uploading').length;

  return (
    <div
      className="relative flex min-h-screen flex-col bg-[#0f1117]"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag overlay with animation */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#0f1117]/90 backdrop-blur-sm transition-all duration-200">
          <div className="animate-pulse rounded-2xl border-2 border-dashed border-[#3b82f6] bg-[#3b82f6]/10 px-16 py-12 text-center shadow-[0_0_60px_rgba(59,130,246,0.15)]">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#3b82f6]/20">
              <svg className="text-[#3b82f6]" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="text-base font-semibold text-white">Drop files here</p>
            <p className="mt-1.5 text-sm text-[#9ca3af]">DICOM files, ZIP archives, or folders</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#1e2433] bg-[#0f1117] px-5 py-2.5">
        {/* Brand + status */}
        <div className="flex items-center gap-2.5">
          <img src="/ukubona-logo.png" alt="Ukubona" className="h-12 object-contain" />
          <div className={`h-2 w-2 rounded-full ${orthancOnline ? 'bg-emerald-500' : 'bg-red-500'}`} title={orthancOnline ? 'Orthanc online' : 'Orthanc offline'} />
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-md mx-6">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#4b5563]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search patients, descriptions..."
            className="w-full rounded-lg border border-[#1e2433] bg-[#161b26] py-1.5 pl-8 pr-3 text-sm text-white placeholder-[#4b5563] outline-none focus:border-[#3b82f6]/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => fileInputRef.current?.click()} className="rounded-md border border-[#1e2433] bg-[#161b26] px-2.5 py-1.5 text-xs text-[#9ca3af] hover:text-white hover:border-[#2a3040] transition" title="Upload DICOM / ZIP files">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline mr-1"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            Upload Files
          </button>
          <button onClick={handleFolderPick} className="rounded-md border border-[#1e2433] bg-[#161b26] px-2.5 py-1.5 text-xs text-[#9ca3af] hover:text-white hover:border-[#2a3040] transition" title="Upload folder">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline mr-1"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
            Upload Folder
          </button>
          <div className="mx-1 h-4 w-px bg-[#1e2433]" />
          <button onClick={fetchStudies} className="rounded-md p-1.5 text-[#6b7280] hover:text-white transition" title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
          <button onClick={handleOpenSettings} className="rounded-md p-1.5 text-[#6b7280] hover:text-white transition" title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
          <button onClick={async () => {
            const hasWindows = await tauri.hasOpenPopupWindows();
            setLogoutHasWindows(hasWindows);
            setLogoutConfirm(true);
          }} className="rounded-md p-1.5 text-[#6b7280] hover:text-red-400 transition" title="Sign out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
      </header>

      {/* Upload toasts */}
      {uploadJobs.length > 0 && (
        <div className="fixed bottom-4 right-4 z-30 flex flex-col gap-2 w-72">
          {uploadJobs.slice(-4).map(job => (
            <div key={job.id} className={[
              'flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs border',
              job.status === 'success' ? 'border-emerald-500/20 bg-[#161b26] text-emerald-400' :
              job.status === 'error'   ? 'border-red-500/20 bg-[#161b26] text-red-400' :
                                         'border-[#1e2433] bg-[#161b26] text-[#9ca3af]',
            ].join(' ')}>
              {job.status === 'uploading' && <div className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />}
              {job.status === 'success' && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>}
              {job.status === 'error' && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>}
              <span className="flex-1 truncate">{job.status === 'uploading' ? `Uploading ${job.name}...` : job.status === 'success' ? `Imported: ${job.name}` : job.error ?? 'Upload failed'}</span>
              <button onClick={() => setUploadJobs(prev => prev.filter(j => j.id !== job.id))} className="flex-shrink-0 opacity-40 hover:opacity-100">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main */}
      <main className="flex-1 px-5 py-4">
        {/* Stats + filters */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#d1d5db]">
              {filtered.length} <span className="text-[#6b7280]">{filtered.length === 1 ? 'study' : 'studies'}</span>
            </span>
            {activeUploads > 0 && (
              <span className="flex items-center gap-1 text-xs text-[#3b82f6]">
                <div className="h-2 w-2 animate-spin rounded-full border border-[#3b82f6] border-t-transparent" />
                {activeUploads} uploading
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-0.5">
            {MODALITY_FILTERS.map(m => (
              <button
                key={m}
                onClick={() => setModalityFilter(m)}
                className={[
                  'rounded-md px-2 py-1 text-xs transition',
                  modalityFilter === m
                    ? 'bg-[#3b82f6]/15 text-[#3b82f6] font-medium'
                    : 'text-[#6b7280] hover:text-[#d1d5db]',
                ].join(' ')}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex flex-col items-center gap-3 pt-20">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
            <p className="text-sm text-[#6b7280]">Loading studies...</p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasSearch={!!search || modalityFilter !== 'ALL'} onUpload={() => fileInputRef.current?.click()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {filtered.map(study => (
              <StudyCard
                key={study.studyInstanceUid}
                studyInstanceUid={study.studyInstanceUid}
                patientName={study.patientName}
                patientId={study.patientId}
                studyDescription={study.studyDescription}
                studyDate={study.studyDate}
                modalities={study.modalities}
                seriesCount={study.seriesCount}
                instanceCount={study.instanceCount}
                onClick={() => handleStudyClick(study)}
                onOpenMode={mode => openStudy(study, mode)}
                onDelete={() => handleDelete(study)}
                onOpenReport={() => handleOpenReport(study)}
                onOpenAI={() => handleOpenAI(study)}
                isLoading={loadingStudy === study.studyInstanceUid}
              />
            ))}
          </div>
        )}
      </main>

      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" accept=".dcm,.DCM,.dicom,.zip,.ZIP" multiple className="hidden"
        onChange={e => { handleDroppedFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

      {modeModal && (
        <ModeSelectModal
          studyInstanceUID={modeModal.studyInstanceUid}
          modalities={modeModal.modalities}
          patientName={modeModal.patientName}
          onSelect={mode => { setModeModal(null); openStudy(modeModal, mode); }}
          onClose={() => setModeModal(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[#1e2433] bg-[#161b26] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white">Delete Study</h3>
            <p className="mt-2 text-xs text-[#9ca3af]">
              Remove <span className="font-medium text-white">{deleteConfirm.patientName}</span> from the viewer?
            </p>
            <p className="mt-1 text-[10px] text-[#4b5563]">This removes the study from Orthanc. Local files are not deleted.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="rounded-lg px-4 py-1.5 text-xs text-[#9ca3af] hover:bg-white/5">Cancel</button>
              <button onClick={confirmDelete} className="rounded-lg bg-red-500/90 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Logout confirmation dialog */}
      {logoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setLogoutConfirm(false)}>
          <div className="w-full max-w-sm rounded-xl border border-[#1e2433] bg-[#161b26] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h3 className="text-sm font-semibold text-white">Sign Out</h3>
            </div>
            <p className="text-xs text-[#9ca3af]">Are you sure you want to sign out?</p>
            {logoutHasWindows && (
              <p className="mt-2 text-xs text-amber-400/90">
                You have open report or AI windows. Signing out will close all popup windows.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setLogoutConfirm(false)} className="rounded-lg px-4 py-1.5 text-xs text-[#9ca3af] hover:bg-white/5">Cancel</button>
              <button
                onClick={async () => {
                  setLogoutConfirm(false);
                  if (logoutHasWindows) {
                    await tauri.closeAllPopupWindows();
                  }
                  clearSession();
                  setAuthed(false);
                }}
                className="rounded-lg bg-red-500/90 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-600"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasSearch, onUpload }: { hasSearch: boolean; onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-20">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1">
        <rect x="2" y="3" width="20" height="18" rx="2" /><path d="M8 10h8M8 14h5" />
      </svg>
      <p className="text-sm text-[#9ca3af]">{hasSearch ? 'No matching studies' : 'No studies loaded'}</p>
      <p className="text-xs text-[#4b5563]">{hasSearch ? 'Try clearing filters' : 'Drop files here or use upload buttons'}</p>
      {!hasSearch && (
        <button onClick={onUpload} className="mt-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2563eb] transition">
          Upload DICOM Files
        </button>
      )}
    </div>
  );
}

async function fetchFromOrthancDirect(): Promise<StudyItem[]> {
  const ORTHANC = tauri.getOrthancBase();
  const ids: string[] = await fetch(`${ORTHANC}/studies`).then(r => r.json());
  return Promise.all(
    ids.map(async id => {
      const [meta, stats] = await Promise.all([
        fetch(`${ORTHANC}/studies/${id}?requestedTags=ModalitiesInStudy`).then(r => r.json()),
        fetch(`${ORTHANC}/studies/${id}/statistics`).then(r => r.json()).catch(() => null),
      ]);
      const main = meta.MainDicomTags ?? {};
      const patient = meta.PatientMainDicomTags ?? {};
      // ModalitiesInStudy may be in MainDicomTags, RequestedTags, or derived from Series
      let modalities = main.ModalitiesInStudy
        ?? meta.RequestedTags?.ModalitiesInStudy
        ?? '';
      // Fallback: derive modalities from series if still empty
      if (!modalities && Array.isArray(meta.Series) && meta.Series.length > 0) {
        try {
          const seriesMods = await Promise.all(
            meta.Series.slice(0, 10).map((sid: string) =>
              fetch(`${ORTHANC}/series/${sid}`).then(r => r.json())
                .then(s => s.MainDicomTags?.Modality ?? '')
                .catch(() => '')
            )
          );
          modalities = [...new Set(seriesMods.filter(Boolean))].join('\\');
        } catch { /* ignore */ }
      }
      return {
        studyInstanceUid: main.StudyInstanceUID ?? '',
        patientName: patient.PatientName ?? 'Unknown',
        patientId: patient.PatientID ?? '',
        studyDescription: main.StudyDescription ?? '',
        studyDate: main.StudyDate ?? '',
        modalities,
        seriesCount: stats?.CountSeries ?? (meta.Series ?? []).length,
        instanceCount: stats?.CountInstances ?? 0,
        orthancId: id,
      };
    })
  );
}
