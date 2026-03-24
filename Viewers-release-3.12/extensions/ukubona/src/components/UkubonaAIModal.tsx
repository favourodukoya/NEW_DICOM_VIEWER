/**
 * UkubonaAIModal — Modern AI analysis panel.
 *
 * Features:
 *   - Study metadata header (fetched from Orthanc if props missing)
 *   - View Study button (with viewer-active warning)
 *   - Clean dark UI with no high-contrast white borders
 *   - Model selection grid
 *   - Credits display
 *   - Results view
 */
import React, { useState, useEffect } from 'react';
import * as tauri from '../tauriBridge';

// ─── Icon primitives ──────────────────────────────────────────────────────────

function SvgIcon({ path, size = 20, className = '' }: { path: React.ReactNode; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      {path}
    </svg>
  );
}

// ─── Model icons ──────────────────────────────────────────────────────────────

const ICONS: Record<string, React.FC<{ className?: string; size?: number }>> = {
  fracture_detection: ({ className, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.5 2a2.5 2.5 0 0 0-2.4 3.2L8.2 13.1A2.5 2.5 0 0 0 5.5 12 2.5 2.5 0 0 0 3 14.5c0 .8.4 1.5.9 2a2.5 2.5 0 0 0-.9 2A2.5 2.5 0 0 0 5.5 21c.8 0 1.5-.4 2-.9a2.5 2.5 0 0 0 2 .9 2.5 2.5 0 0 0 2.4-3.2l7.9-7.9A2.5 2.5 0 0 0 22 8.5a2.5 2.5 0 0 0-.9-2 2.5 2.5 0 0 0 .9-2A2.5 2.5 0 0 0 18.5 2z" />
    </svg>
  ),
  tumor_detection: ({ className, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  lung_analysis: ({ className, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2v10M12 12c-1.5 2-4 3-6 5.5C4.5 19 4 20.5 5.5 21.5c1.5 1 3 .5 4.5-.5 1-.7 1.5-1.5 2-2.5M12 12c1.5 2 4 3 6 5.5 1.5 1.5 2 3 .5 4-.5.4-1 .5-1.5.5-1 0-2-.5-3-1.5-1-.7-1.5-1.5-2-2.5M8 6c-2 1-4 3-5 6-.5 1.5-.5 3 .5 3.5s2-.5 2.5-2c.3-.8.5-1.5.5-2.5M16 6c2 1 4 3 5 6 .5 1.5.5 3-.5 3.5s-2-.5-2.5-2c-.3-.8-.5-1.5-.5-2.5" />
    </svg>
  ),
  brain_mri: ({ className, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M12 2a5 5 0 0 1 4.6 3A4.5 4.5 0 0 1 21 9.5a4.5 4.5 0 0 1-2.1 3.8A5 5 0 0 1 16 18.5a4 4 0 0 1-4 3.5 4 4 0 0 1-4-3.5 5 5 0 0 1-2.9-5.2A4.5 4.5 0 0 1 3 9.5 4.5 4.5 0 0 1 7.4 5 5 5 0 0 1 12 2z" />
      <path d="M12 2v20" /><path d="M8 5.5c1.5 1 3.5 1 5 0" />
      <path d="M7 10c2 1 4.5 1 6.5 0" /><path d="M7.5 15c2 1 4 1 6 0" />
    </svg>
  ),
  chest_xr: ({ className, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M19.5 12.5c0 3.6-3 7.5-7.5 9.5-4.5-2-7.5-5.9-7.5-9.5V5l7.5-3L19.5 5v7.5z" />
      <path d="M12 8v4M10 10h4" />
    </svg>
  ),
};

const MODEL_COLORS: Record<string, string> = {
  fracture_detection: '#f59e0b',
  tumor_detection: '#ef4444',
  lung_analysis: '#06b6d4',
  brain_mri: '#8b5cf6',
  chest_xr: '#10b981',
};

// ─── Data ─────────────────────────────────────────────────────────────────────

interface AIModel {
  id: string;
  name: string;
  description: string;
  modalities: string[];
  credits: number;
}

const AI_MODELS: AIModel[] = [
  { id: 'fracture_detection', name: 'Fracture Detection', description: 'Detects bone fractures in X-ray and CT with bounding box overlays.', modalities: ['CR', 'DX', 'CT'], credits: 5 },
  { id: 'tumor_detection', name: 'Tumor Detection', description: 'Identifies suspicious lesions and masses across CT and MRI.', modalities: ['CT', 'MR'], credits: 10 },
  { id: 'lung_analysis', name: 'Lung Analysis', description: 'Segments lung parenchyma; detects nodules, consolidation.', modalities: ['CT'], credits: 8 },
  { id: 'brain_mri', name: 'Brain MRI Analysis', description: 'Segments brain structures, detects lesions and anomalies.', modalities: ['MR'], credits: 12 },
  { id: 'chest_xr', name: 'Chest X-Ray Triage', description: 'Rapid triage: pneumonia, pleural effusion, cardiomegaly.', modalities: ['CR', 'DX'], credits: 3 },
];

const DUMMY_CREDITS = { remaining: 247, total: 500 };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIResult {
  model_id: string;
  findings: string[];
  confidence: number;
  overlay?: unknown;
}

interface UkubonaAIModalProps {
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  patientName?: string;
  patientId?: string;
  modality?: string;
  studyDate?: string;
  onClose: () => void;
  onResultsReceived?: (results: AIResult) => void;
  apiEndpoint?: string;
}

// ─── Study metadata hook (same pattern as ReportManager) ─────────────────────

interface StudyMeta { patientName: string; patientId: string; modality: string; studyDate: string; }

function useStudyMeta(uid: string, props: Partial<StudyMeta>): StudyMeta {
  const [meta, setMeta] = useState<StudyMeta>({
    patientName: props.patientName || '', patientId: props.patientId || '',
    modality: props.modality || '', studyDate: props.studyDate || '',
  });
  useEffect(() => {
    if (props.patientName && props.patientId && props.modality) return;
    if (!uid) return;
    const ORTHANC = tauri.getOrthancBase();
    async function fetch_meta() {
      try {
        const findResp = await fetch(`${ORTHANC}/tools/find`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Level: 'Study', Query: { StudyInstanceUID: uid }, Limit: 1 }),
        });
        if (!findResp.ok) return;
        const ids: string[] = await findResp.json();
        if (!ids.length) return;
        const study = await fetch(`${ORTHANC}/studies/${ids[0]}?requestedTags=ModalitiesInStudy`).then(r => r.json());
        const main = study.MainDicomTags ?? {};
        const patient = study.PatientMainDicomTags ?? {};
        let modality = main.ModalitiesInStudy || study.RequestedTags?.ModalitiesInStudy || '';
        if (!modality && Array.isArray(study.Series) && study.Series.length > 0) {
          const mods = await Promise.all(
            study.Series.slice(0, 5).map((sid: string) =>
              fetch(`${ORTHANC}/series/${sid}`).then(r => r.json()).then(s => s.MainDicomTags?.Modality || '').catch(() => '')
            )
          );
          modality = [...new Set(mods.filter(Boolean))].join('\\');
        }
        setMeta(prev => ({
          patientName: prev.patientName || patient.PatientName || '',
          patientId: prev.patientId || patient.PatientID || '',
          modality: prev.modality || modality || '',
          studyDate: prev.studyDate || main.StudyDate || '',
        }));
      } catch {}
    }
    fetch_meta();
  }, [uid, props.patientName, props.patientId, props.modality]);
  return meta;
}

function formatDicomDate(d?: string): string {
  if (!d) return '';
  const c = d.replace(/\D/g, '');
  if (c.length === 8) return `${c.slice(6, 8)}/${c.slice(4, 6)}/${c.slice(0, 4)}`;
  return d;
}

// ─── Results view ─────────────────────────────────────────────────────────────

function ResultsView({ result, modelDef, onClose, onRunAnother }: {
  result: AIResult; modelDef?: AIModel; onClose: () => void; onRunAnother: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <div>
          <p className="text-sm font-medium text-emerald-400">Analysis Complete</p>
          <p className="text-xs text-[#6b7280]">{modelDef?.name} — Confidence: {(result.confidence * 100).toFixed(1)}%</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#4b5563]">Findings</p>
        {result.findings.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {result.findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl bg-[#161b26] border border-[#1e2433] px-4 py-3 text-sm text-[#d1d5db]">
                <span className="mt-0.5 text-[#3b82f6] flex-shrink-0">›</span>
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#6b7280]">No significant findings.</p>
        )}
      </div>

      {result.overlay && (
        <p className="text-xs text-emerald-400/80">Overlay data received — overlays will appear in the viewer.</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onRunAnother} className="rounded-xl bg-[#161b26] border border-[#1e2433] px-4 py-2.5 text-sm text-[#9ca3af] hover:text-white transition">
          Run Another
        </button>
        <button onClick={onClose} className="rounded-xl bg-[#3b82f6] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2563eb] transition">
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({ open, title, message, confirmLabel, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-[#1e2433] bg-[#161b26] p-6 shadow-2xl">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-[#9ca3af]">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl px-4 py-2 text-xs text-[#9ca3af] hover:bg-white/5">Cancel</button>
          <button onClick={onConfirm} className="rounded-xl bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2563eb]">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type RunStatus = 'idle' | 'running' | 'done' | 'error';

export default function UkubonaAIModal({
  studyInstanceUID,
  seriesInstanceUID,
  patientName: propPatient,
  patientId: propId,
  modality: propModality,
  studyDate: propDate,
  onClose,
  onResultsReceived,
  apiEndpoint = '/api/ai/run',
}: UkubonaAIModalProps) {
  const meta = useStudyMeta(studyInstanceUID, {
    patientName: propPatient, patientId: propId, modality: propModality, studyDate: propDate,
  });

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [result, setResult] = useState<AIResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerWarning, setViewerWarning] = useState(false);

  const creditsPercent = (DUMMY_CREDITS.remaining / DUMMY_CREDITS.total) * 100;
  const selectedModelDef = AI_MODELS.find(m => m.id === selectedModel);

  const handleRun = async () => {
    if (!selectedModel) return;
    setStatus('running'); setError(null); setResult(null);
    try {
      const resp = await fetch(apiEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ StudyInstanceUID: studyInstanceUID, SeriesInstanceUID: seriesInstanceUID, model: selectedModel }),
      });
      if (!resp.ok) throw new Error(`API error: ${resp.status} ${resp.statusText}`);
      const data: AIResult = await resp.json();
      setResult(data); setStatus('done'); onResultsReceived?.(data);
    } catch (e) { setError(String(e)); setStatus('error'); }
  };

  const handleViewStudy = () => {
    try {
      const vs = localStorage.getItem('ukubona_viewer_active');
      if (vs) {
        const parsed = JSON.parse(vs);
        if (Date.now() - parsed.ts < 3_600_000) { setViewerWarning(true); return; }
      }
    } catch {}
    doViewStudy();
  };

  const doViewStudy = async () => {
    setViewerWarning(false);
    if (tauri.isTauri()) {
      try {
        await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' });
        const bc = new BroadcastChannel('ukubona_nav');
        bc.postMessage({ action: 'view_study', uid: studyInstanceUID });
        bc.close();
      } catch (e) { console.error('View Study failed:', e); }
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0d1117] overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-shrink-0 border-b border-[#1e2433] bg-[#0f1117] px-5 py-3">
        <div className="flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#3b82f6]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[#60a5fa]">
                <path d="M11 22H2v-9h9zm11 0h-9v-9h9zM11 11H2V2h9zm8.455-6.456L22.68 6l-3.225 1.455L18 10.68l-1.456-3.225L13.32 6l3.224-1.456L18 1.32z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Ukubona AI</h2>
              <p className="text-[10px] text-[#4b5563]">AI-assisted diagnostic analysis</p>
            </div>
          </div>

          {/* Credits */}
          <div className="flex items-center gap-2 rounded-xl bg-[#161b26] border border-[#1e2433] px-3 py-1.5">
            <div className="relative h-4 w-4">
              <svg viewBox="0 0 36 36" className="h-4 w-4 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e2433" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="3"
                  strokeDasharray={`${creditsPercent} 100`} strokeLinecap="round"
                  style={{ strokeDasharray: `${creditsPercent * 0.9999} 100` }}
                />
              </svg>
            </div>
            <span className="text-xs font-semibold text-white">{DUMMY_CREDITS.remaining}</span>
            <span className="text-[10px] text-[#4b5563]">credits</span>
          </div>
        </div>

        {/* Study info row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {meta.patientName && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[#4b5563]">Patient</span>
              <span className="text-xs font-medium text-[#e5e7eb]">{meta.patientName}</span>
            </div>
          )}
          {meta.patientId && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[#4b5563]">ID</span>
              <span className="text-xs text-[#9ca3af]">{meta.patientId}</span>
            </div>
          )}
          {meta.modality && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[#4b5563]">Modality</span>
              <span className="text-xs font-semibold text-[#60a5fa]">{meta.modality}</span>
            </div>
          )}
          {meta.studyDate && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[#4b5563]">Date</span>
              <span className="text-xs text-[#9ca3af]">{formatDicomDate(meta.studyDate)}</span>
            </div>
          )}
          <button
            onClick={handleViewStudy}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[#60a5fa] hover:bg-[#3b82f6]/10 transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
            </svg>
            View Study
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-5">
        {(status === 'idle' || status === 'error') && (
          <>
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-[#4b5563]">
              Select AI Model
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              {AI_MODELS.map(model => {
                const IconComp = ICONS[model.id];
                const color = MODEL_COLORS[model.id] || '#3b82f6';
                const isSelected = selectedModel === model.id;

                return (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={[
                      'group relative flex flex-col items-center rounded-xl p-4 text-center transition-all duration-150',
                      isSelected
                        ? 'bg-[#3b82f6]/10 border border-[#3b82f6]/40 shadow-lg shadow-[#3b82f6]/5'
                        : 'bg-[#161b26] border border-[#1e2433] hover:border-[#2a3040] hover:bg-[#1a2030]',
                    ].join(' ')}
                  >
                    <div
                      className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl transition-colors"
                      style={{ backgroundColor: `${color}18` }}
                    >
                      {IconComp && (
                        <IconComp
                          size={22}
                          className={isSelected ? 'text-[#60a5fa]' : ''}
                          style={isSelected ? undefined : { color } as any}
                        />
                      )}
                    </div>
                    <h3 className="text-xs font-semibold text-[#e5e7eb]">{model.name}</h3>
                    <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                      {model.modalities.map(m => (
                        <span key={m} className="rounded bg-[#0f1117] px-1.5 py-0.5 text-[9px] font-medium text-[#6b7280]">{m}</span>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-[#6b7280]">{model.description}</p>
                    <p className="mt-1.5 text-[10px] font-semibold text-[#4b5563]">{model.credits} credits</p>

                    {isSelected && (
                      <div className="absolute top-2 right-2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#3b82f6]">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {status === 'error' && error && (
              <div className="mt-4 rounded-xl bg-red-900/20 border border-red-500/20 p-3 text-xs text-red-400">{error}</div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm text-[#6b7280] hover:bg-white/5 transition">
                Cancel
              </button>
              <button
                onClick={handleRun}
                disabled={!selectedModel}
                className={[
                  'rounded-xl px-5 py-2.5 text-sm font-medium transition-all',
                  selectedModel
                    ? 'bg-[#3b82f6] text-white hover:bg-[#2563eb] shadow-lg shadow-[#3b82f6]/20'
                    : 'bg-[#161b26] border border-[#1e2433] text-[#4b5563] cursor-not-allowed',
                ].join(' ')}
              >
                Run Analysis{selectedModelDef ? ` (${selectedModelDef.credits} cr)` : ''}
              </button>
            </div>
          </>
        )}

        {status === 'running' && (
          <div className="flex flex-col items-center gap-5 py-12">
            <div className="relative">
              <div className="h-14 w-14 animate-spin rounded-full border-2 border-[#1e2433] border-t-[#3b82f6]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-[#3b82f6]">
                  <path d="M11 22H2v-9h9zm11 0h-9v-9h9zM11 11H2V2h9zm8.455-6.456L22.68 6l-3.225 1.455L18 10.68l-1.456-3.225L13.32 6l3.224-1.456L18 1.32z" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white">Running {selectedModelDef?.name}…</p>
              <p className="mt-1 text-xs text-[#6b7280]">Uploading study and analysing…</p>
            </div>
          </div>
        )}

        {status === 'done' && result && (
          <ResultsView
            result={result}
            modelDef={selectedModelDef}
            onClose={onClose}
            onRunAnother={() => { setStatus('idle'); setResult(null); }}
          />
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex-shrink-0 border-t border-[#1e2433] bg-[#0f1117] px-5 py-2">
        <p className="truncate font-mono text-[9px] text-[#1e2433]" title={studyInstanceUID}>{studyInstanceUID}</p>
      </div>

      {/* Viewer warning modal */}
      <ConfirmModal
        open={viewerWarning}
        title="Study Open in Viewer"
        message="A study is currently open in the main viewer. Proceeding will navigate to this study instead."
        confirmLabel="Proceed"
        onConfirm={doViewStudy}
        onCancel={() => setViewerWarning(false)}
      />
    </div>
  );
}
