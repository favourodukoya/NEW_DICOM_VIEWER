import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StudyCard from './StudyCard';
import LoginPage, { isAuthenticated, clearSession } from './LoginPage';
import ModeSelectModal, { getApplicableModes, ViewerMode } from './ModeSelectModal';
import PacsModal from './PacsModal';
import * as tauri from '../tauriBridge';

// ─── Ephemeral study tracking ─────────────────────────────────────────────────
// Studies opened via Open DICOM/ZIP/Folder/CD/deep-link are "ephemeral":
// they are uploaded to storage for viewing but removed automatically when closed.
// The list of ephemeral study UIDs survives crashes (stored in localStorage)
// so that orphans are cleaned up on the next startup.

const EPHEMERAL_KEY = 'ukubona_ephemeral_studies';

function getEphemeralUids(): string[] {
  try { return JSON.parse(localStorage.getItem(EPHEMERAL_KEY) || '[]'); } catch { return []; }
}
function addEphemeralUids(uids: string[]) {
  if (!uids.length) return;
  const existing = new Set(getEphemeralUids());
  uids.forEach(u => existing.add(u));
  try { localStorage.setItem(EPHEMERAL_KEY, JSON.stringify([...existing])); } catch {}
}
function removeEphemeralUids(uids: string[]) {
  const existing = new Set(getEphemeralUids());
  uids.forEach(u => existing.delete(u));
  try { localStorage.setItem(EPHEMERAL_KEY, JSON.stringify([...existing])); } catch {}
}
function clearEphemeralUids() {
  try { localStorage.removeItem(EPHEMERAL_KEY); } catch {}
}

async function deleteEphemeralUids(uids: string[]) {
  if (!uids.length) return;
  await Promise.allSettled(uids.map(uid =>
    tauri.isTauri()
      ? tauri.deleteStudyByUid(uid)
      : tauri.deleteStudyByUidHttp(uid)
  ));
}

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
  const [uploadJobs, setUploadJobs] = useState<Array<{
    id: string; name: string; status: 'uploading' | 'success' | 'error'; error?: string;
  }>>([]);
  const [modeModal, setModeModal] = useState<StudyItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<StudyItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0); // tracks nested enter/leave so overlay doesn't flicker
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutHasWindows, setLogoutHasWindows] = useState(false);
  const [showPacs, setShowPacs] = useState(false);
  const [showPersistModal, setShowPersistModal] = useState(false);
  const [opticalDrives, setOpticalDrives] = useState<tauri.OpticalDrive[]>([]);
  const [cdLoading, setCdLoading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // ── Fetch studies ───────────────────────────────────────────────────────────
  const fetchStudies = useCallback(async () => {
    setLoading(true);
    try {
      if (tauri.isTauri()) {
        const status = await tauri.getOrthancStatus();
        setOrthancOnline(status.running);
        const data = await tauri.getStudies();
        console.debug('[ukubona] getStudies raw response:', JSON.stringify(data));
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

  // ── Ephemeral study cleanup ──────────────────────────────────────────────────
  // On mount: delete any ephemeral studies left over from a previous crashed session.
  // On beforeunload / Tauri close: delete all current ephemeral studies.
  useEffect(() => {
    if (!authed) return;

    // Startup cleanup — runs once after studies are loaded
    const orphans = getEphemeralUids();
    if (orphans.length) {
      deleteEphemeralUids(orphans).then(() => {
        clearEphemeralUids();
        setTimeout(() => fetchStudies(), 600);
      });
    }

    // beforeunload: best-effort sync cleanup via synchronous XHR to Orthanc
    const handleUnload = () => {
      const uids = getEphemeralUids();
      if (!uids.length) return;
      const base = tauri.getOrthancBase();
      // For each uid, send a synchronous find+delete (browsers allow sync XHR in unload)
      for (const uid of uids) {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${base}/tools/find`, false);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(JSON.stringify({ Level: 'Study', Query: { StudyInstanceUID: uid } }));
          const ids: string[] = JSON.parse(xhr.responseText || '[]');
          for (const id of ids) {
            const del = new XMLHttpRequest();
            del.open('DELETE', `${base}/studies/${id}`, false);
            del.send();
          }
        } catch { /* best-effort */ }
      }
      clearEphemeralUids();
    };
    window.addEventListener('beforeunload', handleUnload);

    // Tauri-specific: intercept window close to do async cleanup before allowing close.
    // Uses tauriBridge helpers to avoid importing @tauri-apps/api directly, which causes
    // rspack to crash in dev mode with "Cannot read properties of undefined (reading 'call')".
    let unlisten: (() => void) | undefined;
    if (tauri.isTauri()) {
      (async () => {
        try {
          unlisten = await tauri.onCloseRequested(async () => {
            const uids = getEphemeralUids();
            await deleteEphemeralUids(uids);
            clearEphemeralUids();
          });
        } catch { /* not critical */ }
      })();
    }

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      unlisten?.();
    };
  }, [authed, fetchStudies]);

  // ── Deep-link / "Open with" file handler ────────────────────────────────────
  // Tauri emits 'ukubona://open-files' with an array of file paths when the app
  // is launched by double-clicking a .dcm or .zip file, or via the ukubona:// URI scheme.
  useEffect(() => {
    if (!tauri.isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        // Use __TAURI_INTERNALS__.listen directly to avoid importing @tauri-apps/api/event,
        // which crashes rspack in dev mode before __TAURI_INTERNALS__ is available.
        const tauriListen = (window as any).__TAURI_INTERNALS__?.listen;
        if (!tauriListen) return;
        unlisten = await tauriListen('ukubona://open-files', async (event: { payload: string[] }) => {
          const rawPaths: string[] = event.payload ?? [];
          if (!rawPaths.length) return;
          // Strip ukubona:// or file:// prefix if present
          const paths = rawPaths.map(p => p.replace(/^(ukubona:\/\/open\?path=|file:\/\/\/?)/, ''));
          const label = paths.length === 1
            ? (paths[0].split(/[\\/]/).pop() ?? paths[0])
            : `${paths.length} files`;
          const id = Math.random().toString(36).slice(2);
          setUploadJobs(prev => [...prev, { id, name: label, status: 'uploading' }]);
          try {
            const results = await tauri.uploadDicomPaths(paths);
            const uids = results.filter(r => r.success && r.study_uid).map(r => r.study_uid);
            addEphemeralUids(uids);
            setUploadJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'success' } : j));
            setTimeout(() => fetchStudies(), 600);
          } catch (e) {
            setUploadJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'error', error: String(e) } : j));
          }
          setTimeout(() => setUploadJobs(prev => prev.filter(j => j.id !== id)), 4000);
        });
      } catch { /* not in Tauri or event API unavailable */ }
    })();
    return () => { unlisten?.(); };
  }, [fetchStudies]);

  // ── Tauri native file drop ────────────────────────────────────────────────────
  // Tauri v2 intercepts OS file drops before the browser sees them.
  // e.dataTransfer.files is always empty. Use onDragDropEvent() instead.
  useEffect(() => {
    if (!tauri.isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unlisten = await getCurrentWebview().onDragDropEvent(async event => {
          const payload = event.payload as { type: string; paths?: string[] };
          if (payload.type === 'enter') {
            dragCounter.current += 1;
            setDragging(true);
          } else if (payload.type === 'leave') {
            dragCounter.current = 0;
            setDragging(false);
          } else if (payload.type === 'drop') {
            dragCounter.current = 0;
            setDragging(false);
            const paths = payload.paths ?? [];
            if (!paths.length) return;
            const label = paths.length === 1
              ? (paths[0].split(/[\\/]/).pop() ?? paths[0])
              : `${paths.length} files`;
            const id = Math.random().toString(36).slice(2);
            setUploadJobs(prev => [...prev, { id, name: label, status: 'uploading' }]);
            try {
              const results = await tauri.uploadDicomPaths(paths);
              const uids = results.filter(r => r.success && r.study_uid).map(r => r.study_uid);
              addEphemeralUids(uids);
              setUploadJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'success' } : j));
              setTimeout(() => fetchStudies(), 600);
            } catch (e) {
              setUploadJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'error', error: String(e) } : j));
            }
            setTimeout(() => setUploadJobs(prev => prev.filter(j => j.id !== id)), 4000);
          }
        });
      } catch { /* not Tauri */ }
    })();
    return () => { unlisten?.(); };
  }, [fetchStudies]);

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

  // ── Optical drive polling ────────────────────────────────────────────────────
  // Poll every 4 seconds; only when the study list is visible (not in viewer).
  useEffect(() => {
    if (!tauri.isTauri()) return;
    const poll = async () => {
      try {
        const drives = await tauri.listOpticalDrives();
        setOpticalDrives(drives);
      } catch { setOpticalDrives([]); }
    };
    poll();
    const timer = setInterval(poll, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleLoadFromCd = useCallback(async (drive: tauri.OpticalDrive) => {
    if (!drive.has_media) return;
    setCdLoading(drive.path);
    const id = Math.random().toString(36).slice(2);
    setUploadJobs(prev => [...prev, { id, name: `CD/DVD (${drive.label})`, status: 'uploading' }]);
    try {
      const results = await tauri.uploadFolder(drive.path);
      const uids = results.filter(r => r.success && r.study_uid).map(r => r.study_uid);
      addEphemeralUids(uids);
      setUploadJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'success' } : j));
      setTimeout(() => fetchStudies(), 600);
    } catch (e) {
      setUploadJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'error', error: String(e) } : j));
    } finally {
      setCdLoading(null);
      setTimeout(() => setUploadJobs(prev => prev.filter(j => j.id !== id)), 5000);
    }
  }, [fetchStudies]);

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
      const extra = mode.extraParams ?? '';
      navigate(`/${mode.route}${mode.dataPath}?StudyInstanceUIDs=${study.studyInstanceUid}${extra}`);
    } catch {
      const extra = mode.extraParams ?? '';
      navigate(`/${mode.route}${dataPath}?StudyInstanceUIDs=${study.studyInstanceUid}${extra}`);
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

  // Listen for messages from the PACS results window after retrieval
  useEffect(() => {
    const bc = new BroadcastChannel('ukubona_refresh');
    bc.onmessage = (e) => {
      if (e.data?.action === 'refresh') {
        // Legacy refresh action
        setTimeout(() => fetchStudies(), 800);
      } else if (e.data?.action === 'open_ephemeral' && e.data?.studyUid) {
        // Retrieved from PACS — mark ephemeral (auto-deleted on close) and open directly
        const uid: string = e.data.studyUid;
        addEphemeralUids([uid]);
        navigate(`/basic/orthanc?StudyInstanceUIDs=${uid}`);
      } else if (e.data?.action === 'open_pacs_study' && e.data?.studyUid) {
        // PACS View button: open a retrieved study with a specific mode
        const uid: string = e.data.studyUid;
        const route: string = e.data.route || 'basic';
        const dp: string = e.data.dataPath || '/orthanc';
        const extra: string = e.data.extraParams || '';
        addEphemeralUids([uid]);
        navigate(`/${route}${dp}?StudyInstanceUIDs=${uid}${extra}`);
      } else if (e.data?.action === 'mark_ephemeral' && Array.isArray(e.data?.studyUids)) {
        // Mark additional retrieved studies as ephemeral without navigating
        addEphemeralUids(e.data.studyUids as string[]);
      }
    };
    return () => bc.close();
  }, [fetchStudies, navigate]);

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

  const handleDroppedFiles = useCallback(async (files: File[], ephemeral = true) => {
    const zips = files.filter(f => f.name.toLowerCase().endsWith('.zip'));
    const dicoms = files.filter(f => !f.name.toLowerCase().endsWith('.zip'));
    for (const zip of zips) {
      const id = addJob(zip.name);
      try {
        const b64 = await tauri.fileToBase64(zip);
        const results = await tauri.uploadZip(b64, zip.name);
        if (ephemeral) {
          const uids = results.filter(r => r.success && r.study_uid).map(r => r.study_uid);
          addEphemeralUids(uids);
        }
        finishJob(id, true);
      } catch (e) { finishJob(id, false, String(e)); }
    }
    if (dicoms.length > 0) {
      const id = addJob(`${dicoms.length} DICOM file(s)`);
      try {
        const uploads = await Promise.all(dicoms.map(async f => ({ name: f.name, data: await tauri.fileToBase64(f) })));
        const results = await tauri.uploadDicomFiles(uploads);
        if (ephemeral) {
          const uids = results.filter(r => r.success && r.study_uid).map(r => r.study_uid);
          addEphemeralUids(uids);
        }
        finishJob(id, true);
      } catch (e) { finishJob(id, false, String(e)); }
    }
  }, []);

  const handleFolderPick = useCallback(async (ephemeral = true) => {
    try {
      const path = await tauri.openFolderDialog();
      if (!path) return;
      const id = addJob(`Folder: ${(path as string).split(/[\\/]/).pop()}`);
      try {
        const results = await tauri.uploadFolder(path as string);
        if (ephemeral) {
          const uids = results.filter(r => r.success && r.study_uid).map(r => r.study_uid);
          addEphemeralUids(uids);
        }
        finishJob(id, true);
      } catch (e) { finishJob(id, false, String(e)); }
    } catch (e) { console.error(e); }
  }, []);

  // ── Drag-drop (document-level listeners for Tauri webview compatibility) ────
  // React div drag events are unreliable in Tauri webviews for OS file drops.
  // Attaching directly to `document` ensures the browser sees the drag first.
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (dragCounter.current === 1) setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current === 0) setDragging(false);
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) {
        handleDroppedFiles(Array.from(e.dataTransfer.files));
      }
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [handleDroppedFiles]);

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
    >
      {/* Full-page drag overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-[#0d1117]/90 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[#3b82f6]/60 bg-[#3b82f6]/5 px-20 py-14 text-center shadow-[0_0_80px_rgba(59,130,246,0.12)]">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#3b82f6]/15">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white">Drop to import</p>
            <p className="mt-1 text-xs text-[#6b7280]">DICOM files or ZIP archives</p>
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
          {/* Open DICOM file */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-start rounded-md border border-[#1e2433] bg-[#161b26] px-2.5 py-1.5 text-xs text-[#9ca3af] hover:text-white hover:border-[#2a3040] transition"
            title="Open DICOM file(s) — closes when viewer is done"
          >
            <span className="flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Open DICOM file
            </span>
            <span className="mt-0.5 text-[9px] text-[#374151]">.dcm · quick view</span>
          </button>

          {/* Open ZIP file */}
          <button
            onClick={() => zipInputRef.current?.click()}
            className="flex flex-col items-start rounded-md border border-[#1e2433] bg-[#161b26] px-2.5 py-1.5 text-xs text-[#9ca3af] hover:text-white hover:border-[#2a3040] transition"
            title="Open ZIP archive — closes when viewer is done"
          >
            <span className="flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Open ZIP File
            </span>
            <span className="mt-0.5 text-[9px] text-[#374151]">.zip · quick view</span>
          </button>

          {/* Open Folder */}
          <button
            onClick={() => handleFolderPick()}
            className="flex flex-col items-start rounded-md border border-[#1e2433] bg-[#161b26] px-2.5 py-1.5 text-xs text-[#9ca3af] hover:text-white hover:border-[#2a3040] transition"
            title="Open folder — closes when viewer is done"
          >
            <span className="flex items-center gap-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              Open Folder
            </span>
            <span className="mt-0.5 text-[9px] text-[#374151]">Scans subfolders · quick view</span>
          </button>

          <div className="mx-0.5 h-4 w-px bg-[#1e2433]" />

          {/* Load from PACS */}
          <button
            onClick={() => setShowPacs(true)}
            className="flex flex-col items-start rounded-md border border-[#1e2433] bg-[#161b26] px-2.5 py-1.5 text-xs text-[#9ca3af] hover:border-[#2a3040] hover:text-white transition"
            title="Load from PACS"
          >
            <span className="flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
                <circle cx="9" cy="10" r="1.5" />
                <path d="M13 8h4M13 12h3" />
              </svg>
              Load from PACS
            </span>
            <span className="mt-0.5 text-[9px] text-[#374151]">Query remote server</span>
          </button>

          {/* Load from CD — only shown when an optical drive is detected */}
          {opticalDrives.map(drive => (
            <button
              key={drive.path}
              onClick={() => handleLoadFromCd(drive)}
              disabled={cdLoading === drive.path || !drive.has_media}
              title={drive.has_media ? `Load from ${drive.label} (CD/DVD)` : `${drive.label}: No disc inserted`}
              className={[
                'flex flex-col items-start rounded-md border px-2.5 py-1.5 text-xs transition',
                drive.has_media
                  ? 'border-[#3b82f6]/30 bg-[#3b82f6]/8 text-[#60a5fa] hover:border-[#3b82f6]/60 hover:bg-[#3b82f6]/15'
                  : 'border-[#1e2433] bg-[#161b26] text-[#4b5563] cursor-not-allowed',
              ].join(' ')}
            >
              <span className="flex items-center gap-1.5">
                {cdLoading === drive.path ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="3" />
                    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
                  </svg>
                )}
                Load from {drive.label}
              </span>
              <span className={`mt-0.5 text-[9px] ${drive.has_media ? 'text-[#3b82f6]/50' : 'text-[#374151]'}`}>
                {drive.has_media ? 'DICOM disc · quick view' : 'No disc inserted'}
              </span>
            </button>
          ))}

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
            <button
              onClick={() => setShowPersistModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[#2a3040] bg-[#161b26] px-3 py-1 text-xs font-medium text-[#9ca3af] transition hover:border-[#3b82f6]/40 hover:text-white"
              title="Add studies permanently to your library"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add to Studies List
            </button>
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

        {/* ── Drop hint ────────────────────────────────────────────────── */}
        <div className={[
          'mb-3 flex items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs transition-all duration-150',
          dragging
            ? 'border-[#3b82f6]/60 bg-[#3b82f6]/8 text-[#60a5fa] shadow-[0_0_20px_rgba(59,130,246,0.12)]'
            : 'border-[#1e2433]/60 text-[#374151]',
        ].join(' ')}>
          {dragging ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Release to import
            </>
          ) : (
            'Drop DICOM files or ZIP here'
          )}
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
      <input ref={fileInputRef} type="file" accept=".dcm,.DCM,.dicom" multiple className="hidden"
        onChange={e => { handleDroppedFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={zipInputRef} type="file" accept=".zip,.ZIP" multiple className="hidden"
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

      {/* Persist modal — "Add to Studies List" */}
      {showPersistModal && (
        <PersistModal
          onClose={() => setShowPersistModal(false)}
          onUploadFiles={async files => { await handleDroppedFiles(files, false); }}
          onUploadFolder={async () => { await handleFolderPick(false); setShowPersistModal(false); }}
        />
      )}

      {/* PACS modal */}
      {showPacs && (
        <PacsModal
          onClose={() => setShowPacs(false)}
          onStudyRetrieved={() => { setTimeout(fetchStudies, 1500); }}
          onOpenSettings={() => { setShowPacs(false); handleOpenSettings(); }}
        />
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
      <p className="text-xs text-[#4b5563]">{hasSearch ? 'Try clearing filters' : 'Use Open DICOM file, Open Folder, or drag & drop'}</p>
      {!hasSearch && (
        <button onClick={onUpload} className="mt-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2563eb] transition">
          Open DICOM File
        </button>
      )}
    </div>
  );
}

// ─── PersistModal ─────────────────────────────────────────────────────────────
// "Add to Studies List" — uploads are permanent (not ephemeral).

interface PersistModalProps {
  onClose: () => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  onUploadFolder: () => Promise<void>;
}

function PersistModal({ onClose, onUploadFiles, onUploadFolder }: PersistModalProps) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    setBusy(true);
    await onUploadFiles(files);
    setBusy(false);
    onClose();
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    await onUploadFiles(files);
    setBusy(false);
    onClose();
    e.target.value = '';
  };

  const handleFolder = async () => {
    setBusy(true);
    await onUploadFolder();
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl border border-[#1e2433] bg-[#0d1117] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1e2433] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3b82f6]/10">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Add to Studies List</h2>
              <p className="text-[11px] text-[#4b5563]">Studies added here stay in your library permanently</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#4b5563] hover:bg-white/5 hover:text-white transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {/* Drag-drop zone */}
          <div
            onDragEnter={e => { e.preventDefault(); dragCounter.current += 1; setDragging(true); }}
            onDragLeave={e => { e.preventDefault(); dragCounter.current -= 1; if (dragCounter.current === 0) setDragging(false); }}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            className={[
              'flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed py-8 transition-all duration-150 cursor-pointer',
              dragging
                ? 'border-[#3b82f6]/70 bg-[#3b82f6]/8 shadow-[0_0_24px_rgba(59,130,246,0.1)]'
                : 'border-[#1e2433] hover:border-[#2a3040]',
            ].join(' ')}
            onClick={() => fileRef.current?.click()}
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${dragging ? 'bg-[#3b82f6]/15' : 'bg-[#161b26]'} transition`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dragging ? '#60a5fa' : '#6b7280'} strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[#d1d5db]">
                {dragging ? 'Release to add' : 'Drag & drop files here'}
              </p>
              <p className="mt-0.5 text-xs text-[#4b5563]">or click to browse</p>
            </div>
            <p className="text-[10px] text-[#374151]">Individual .dcm files or .zip archives · No size limit</p>
          </div>

          {/* Upload File button */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#1e2433] bg-[#161b26] py-2.5 text-sm text-[#9ca3af] transition hover:border-[#2a3040] hover:text-white disabled:opacity-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Upload File
            </button>
            <button
              onClick={handleFolder}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#1e2433] bg-[#161b26] py-2.5 text-sm text-[#9ca3af] transition hover:border-[#2a3040] hover:text-white disabled:opacity-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              Upload Folder
            </button>
          </div>

          {/* Hint text under each button */}
          <div className="flex gap-2 text-[10px] text-[#374151]">
            <span className="flex-1 text-center">.dcm files and .zip archives supported</span>
            <span className="flex-1 text-center">Scans folder and subfolders for DICOM files</span>
          </div>

          {busy && (
            <div className="flex items-center justify-center gap-2 py-1 text-xs text-[#6b7280]">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
              Importing...
            </div>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".dcm,.DCM,.dicom,.zip,.ZIP" multiple className="hidden" onChange={handleFileInput} />
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
