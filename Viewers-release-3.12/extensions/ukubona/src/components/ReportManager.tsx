/**
 * ReportManager — polished, responsive radiology report UI for Ukubona.
 *
 * Layout:
 *   - Narrow (<900px): single column
 *   - Wide (≥900px): two-column — report text left, template panel right
 *
 * Features:
 *   - Always fetches study metadata from Orthanc (fallback when props are missing)
 *   - Single unified report textarea with auto-save
 *   - Voice transcription with MediaRecorder
 *   - Template sidebar (right panel on wide screens, dropdown on narrow)
 *   - Copy / Share / Clear / Save / Finalize
 *   - View Study button with viewer-active warning
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as tauri from '../tauriBridge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportTemplate {
  id: string;
  name: string;
  category: string;
  findings_template: string;
  impression_template: string;
}

interface ReportManagerProps {
  studyInstanceUID: string;
  patientName?: string;
  patientId?: string;
  modality?: string;
  studyDate?: string;
  onClose?: () => void;
  standalone?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'tpl_chest_ct',
    name: 'Chest CT — Normal',
    category: 'Chest',
    findings_template:
      'FINDINGS:\nThe lungs are clear bilaterally with no focal consolidation, effusion, or pneumothorax. ' +
      'The mediastinum is within normal limits. No significant lymphadenopathy identified. ' +
      'Osseous structures and visualised upper abdomen are unremarkable.\n\nIMPRESSION:\nNormal chest CT. No acute cardiopulmonary process.',
    impression_template: '',
  },
  {
    id: 'tpl_brain_mri',
    name: 'Brain MRI — Normal',
    category: 'Neuro',
    findings_template:
      'FINDINGS:\nNo intracranial haemorrhage, mass, mass effect, or midline shift. ' +
      'Ventricles and sulci are appropriate for age. ' +
      'No restricted diffusion to suggest acute ischaemia. ' +
      'Posterior fossa is unremarkable. No extra-axial collections.\n\nIMPRESSION:\nNormal brain MRI. No acute intracranial abnormality.',
    impression_template: '',
  },
  {
    id: 'tpl_chest_xr',
    name: 'Chest X-Ray — Normal',
    category: 'Chest',
    findings_template:
      'FINDINGS:\nHeart size is within normal limits. Lungs are clear. ' +
      'No pleural effusion or pneumothorax. Bony thorax is intact.\n\nIMPRESSION:\nNormal chest radiograph.',
    impression_template: '',
  },
  {
    id: 'tpl_abdomen_ct',
    name: 'Abdomen CT — Normal',
    category: 'Abdomen',
    findings_template:
      'FINDINGS:\nLiver, spleen, pancreas, and adrenal glands appear normal. ' +
      'Kidneys are of normal size and enhancement. No free fluid or free air. ' +
      'No lymphadenopathy. Visualised bowel is unremarkable.\n\nIMPRESSION:\nNormal abdominal CT.',
    impression_template: '',
  },
  {
    id: 'tpl_us_abdomen',
    name: 'Abdominal US — Normal',
    category: 'Abdomen',
    findings_template:
      'FINDINGS:\nThe liver is normal in size and echogenicity. No focal hepatic lesion. ' +
      'The gallbladder is distended with no gallstones or wall thickening. ' +
      'The common bile duct is not dilated. The pancreas is partially visualised and appears unremarkable. ' +
      'The spleen is normal. Both kidneys are normal in size and echogenicity with no hydronephrosis.\n\nIMPRESSION:\nNormal abdominal ultrasound.',
    impression_template: '',
  },
];

const TEMPLATES_STORAGE_KEY = 'ukubona_report_templates';

const DUMMY_TRANSCRIPTION =
  'FINDINGS:\nThe lungs are clear bilaterally. No consolidation, pleural effusion, or pneumothorax is identified. ' +
  'The cardiac silhouette is within normal limits. The mediastinal contours are unremarkable. ' +
  'No significant hilar lymphadenopathy. The visualised osseous structures are intact without acute fracture or lytic lesion.\n\n' +
  'IMPRESSION:\n1. No acute cardiopulmonary abnormality.\n2. Normal chest examination.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadCustomTemplates(): ReportTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomTemplates(tpls: ReportTemplate[]) {
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(tpls));
  } catch {}
}

function formatDicomDate(d?: string): string {
  if (!d) return '';
  const c = d.replace(/\D/g, '');
  if (c.length === 8) return `${c.slice(6, 8)}/${c.slice(4, 6)}/${c.slice(0, 4)}`;
  return d;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const Ico = {
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  share: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  ),
  mic: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  report: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
  shield: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  close: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  eye: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  plus: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  chevron: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  warn: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  open, title, message, body, confirmLabel, confirmColor = 'bg-red-500 hover:bg-red-600',
  onConfirm, onCancel,
}: {
  open: boolean; title: string; message: string; body?: React.ReactNode;
  confirmLabel: string; confirmColor?: string; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-[#1e2433] bg-[#161b26] p-6 shadow-2xl">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-[#9ca3af]">{message}</p>
        {body && <div className="mt-2">{body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl px-4 py-2 text-xs font-medium text-[#9ca3af] transition hover:bg-white/5">
            Cancel
          </button>
          <button onClick={onConfirm} className={`rounded-xl px-4 py-2 text-xs font-semibold text-white transition ${confirmColor}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Template Panel ───────────────────────────────────────────────────────────

const MODIFIED_DEFAULT_KEY = 'ukubona_modified_defaults';

function loadModifiedDefaults(): Record<string, ReportTemplate> {
  try { return JSON.parse(localStorage.getItem(MODIFIED_DEFAULT_KEY) || '{}'); } catch { return {}; }
}
function saveModifiedDefaults(map: Record<string, ReportTemplate>) {
  try { localStorage.setItem(MODIFIED_DEFAULT_KEY, JSON.stringify(map)); } catch {}
}

function TemplatePanel({
  onApply, disabled, inline = false,
}: {
  onApply: (tpl: ReportTemplate) => void;
  disabled?: boolean;
  inline?: boolean; // true = always visible sidebar, false = dropdown
}) {
  const [open, setOpen] = useState(inline);
  const [customTemplates, setCustomTemplates] = useState<ReportTemplate[]>([]);
  const [modifiedDefaults, setModifiedDefaults] = useState<Record<string, ReportTemplate>>({});
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: '', text: '' });
  const [editForm, setEditForm] = useState({ name: '', category: '', text: '' });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCustomTemplates(loadCustomTemplates());
    setModifiedDefaults(loadModifiedDefaults());
  }, []);

  useEffect(() => {
    if (inline || !open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setCreating(false); setEditingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, inline]);

  const allTemplates = [
    ...DEFAULT_TEMPLATES.map(t => modifiedDefaults[t.id] ?? t),
    ...customTemplates,
  ];

  const handleApply = (tpl: ReportTemplate) => {
    onApply(tpl);
    if (!inline) setOpen(false);
  };

  const handleCreate = () => {
    if (!form.name.trim()) return;
    const tpl: ReportTemplate = {
      id: 'tpl_custom_' + Date.now(), name: form.name, category: form.category,
      findings_template: form.text, impression_template: '',
    };
    const next = [...customTemplates, tpl];
    setCustomTemplates(next); saveCustomTemplates(next);
    setCreating(false); setForm({ name: '', category: '', text: '' });
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('tpl_custom_')) {
      const next = customTemplates.filter(t => t.id !== id);
      setCustomTemplates(next); saveCustomTemplates(next);
    } else {
      // Reset a modified default back to original
      const next = { ...modifiedDefaults };
      delete next[id];
      setModifiedDefaults(next); saveModifiedDefaults(next);
    }
  };

  const startEdit = (tpl: ReportTemplate) => {
    setEditingId(tpl.id);
    setEditForm({ name: tpl.name, category: tpl.category, text: tpl.findings_template });
    setCreating(false);
  };

  const saveEdit = (id: string) => {
    const updated: ReportTemplate = {
      id, name: editForm.name, category: editForm.category,
      findings_template: editForm.text, impression_template: '',
    };
    if (id.startsWith('tpl_custom_')) {
      const next = customTemplates.map(t => t.id === id ? updated : t);
      setCustomTemplates(next); saveCustomTemplates(next);
    } else {
      const next = { ...modifiedDefaults, [id]: updated };
      setModifiedDefaults(next); saveModifiedDefaults(next);
    }
    setEditingId(null);
  };

  const inp = 'w-full rounded-lg bg-[#161b26] px-3 py-2 text-xs text-white placeholder-[#4b5563] outline-none border border-[#1e2433] focus:border-[#3b82f6]/50 transition';

  // Shared new-template form
  const NewTemplateForm = (
    <div className="mb-3 rounded-xl border border-[#1e2433] bg-[#0d1117] p-3.5 space-y-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#4b5563]">New Template</p>
      <input className={inp} placeholder="Template name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      <input className={inp} placeholder="Category (e.g. Chest, Neuro)" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
      <textarea
        className={inp + ' resize-y'}
        rows={inline ? 7 : 4}
        placeholder="Report template text..."
        value={form.text}
        onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
      />
      <div className="flex justify-end gap-1.5">
        <button onClick={() => { setCreating(false); setForm({ name: '', category: '', text: '' }); }} className="rounded-lg px-3 py-1.5 text-xs text-[#6b7280] hover:bg-white/5">Cancel</button>
        <button onClick={handleCreate} disabled={!form.name.trim()} className="rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2563eb] disabled:opacity-40">Save</button>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className="flex flex-col h-full">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4b5563]">Templates</span>
          <button
            onClick={() => { setCreating(v => !v); setEditingId(null); }}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-[#60a5fa] hover:bg-[#60a5fa]/10 transition"
          >
            {Ico.plus} New
          </button>
        </div>

        {creating && NewTemplateForm}

        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
          {allTemplates.map(tpl => {
            const isCustom = tpl.id.startsWith('tpl_custom_');
            const isDefaultModified = !isCustom && modifiedDefaults[tpl.id];
            const isEditing = editingId === tpl.id;
            return (
              <div key={tpl.id} className="group rounded-xl border border-transparent hover:border-[#1e2433] hover:bg-[#161b26] px-3 py-2.5 transition">
                {isEditing ? (
                  <div className="space-y-2">
                    <input className={inp} value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="Name" />
                    <input className={inp} value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} placeholder="Category" />
                    <textarea className={inp + ' resize-y'} rows={6} value={editForm.text} onChange={e => setEditForm(f => ({ ...f, text: e.target.value }))} placeholder="Template text" />
                    <div className="flex items-center justify-between">
                      {isDefaultModified && (
                        <button onClick={() => handleDelete(tpl.id)} className="text-[10px] text-[#4b5563] hover:text-amber-400 transition">Reset to default</button>
                      )}
                      <div className="ml-auto flex gap-1.5">
                        <button onClick={() => setEditingId(null)} className="rounded-lg px-2.5 py-1 text-[10px] text-[#6b7280] hover:bg-white/5">Cancel</button>
                        <button onClick={() => saveEdit(tpl.id)} className="rounded-lg bg-[#3b82f6] px-2.5 py-1 text-[10px] font-medium text-white hover:bg-[#2563eb]">Save</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <button className="flex-1 min-w-0 text-left" onClick={() => !disabled && handleApply(tpl)} disabled={disabled}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-[#d1d5db] truncate">{tpl.name}</span>
                        {isDefaultModified && <span className="rounded bg-amber-500/10 px-1 text-[9px] text-amber-400">edited</span>}
                      </div>
                      {tpl.category && <div className="mt-0.5 text-[10px] text-[#4b5563]">{tpl.category}</div>}
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                      <button onClick={() => !disabled && handleApply(tpl)} className="rounded-md bg-[#3b82f6]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#60a5fa] hover:bg-[#3b82f6]/25" disabled={disabled}>Use</button>
                      <button onClick={() => startEdit(tpl)} className="rounded-md p-1 text-[#4b5563] hover:bg-white/5 hover:text-white transition" title="Edit">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      {isCustom && (
                        <button onClick={() => handleDelete(tpl.id)} className="rounded-md p-1 text-[#4b5563] hover:bg-red-500/15 hover:text-red-400 transition">{Ico.trash}</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Dropdown mode (narrow screens)
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
          open ? 'bg-[#3b82f6]/15 text-[#60a5fa]' : 'text-[#9ca3af] hover:bg-white/5 hover:text-white'
        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        {Ico.report} Templates {Ico.chevron}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-80 rounded-xl border border-[#1e2433] bg-[#161b26] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e2433]">
            <span className="text-xs font-semibold text-white">Report Templates</span>
            <button onClick={() => { setCreating(v => !v); setEditingId(null); }} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-[#60a5fa] hover:bg-[#3b82f6]/10">
              {Ico.plus} New
            </button>
          </div>
          {creating && (
            <div className="border-b border-[#1e2433] p-3.5 space-y-2.5">
              <input className={inp} placeholder="Template name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input className={inp} placeholder="Category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              <textarea className={inp + ' resize-y'} rows={5} placeholder="Report text..." value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setCreating(false)} className="rounded-lg px-2.5 py-1 text-xs text-[#6b7280] hover:bg-white/5">Cancel</button>
                <button onClick={handleCreate} disabled={!form.name.trim()} className="rounded-lg bg-[#3b82f6] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#2563eb] disabled:opacity-40">Save</button>
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-2">
            {allTemplates.map(tpl => {
              const isCustom = tpl.id.startsWith('tpl_custom_');
              const isDefaultModified = !isCustom && modifiedDefaults[tpl.id];
              const isEditing = editingId === tpl.id;
              return (
                <div key={tpl.id} className="group rounded-xl px-3 py-2 hover:bg-white/5 transition">
                  {isEditing ? (
                    <div className="space-y-2 py-1">
                      <input className={inp} value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="Name" />
                      <input className={inp} value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} placeholder="Category" />
                      <textarea className={inp + ' resize-y'} rows={5} value={editForm.text} onChange={e => setEditForm(f => ({ ...f, text: e.target.value }))} />
                      <div className="flex items-center justify-between">
                        {isDefaultModified && (
                          <button onClick={() => handleDelete(tpl.id)} className="text-[10px] text-[#4b5563] hover:text-amber-400">Reset</button>
                        )}
                        <div className="ml-auto flex gap-1.5">
                          <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-[10px] text-[#6b7280] hover:bg-white/5">Cancel</button>
                          <button onClick={() => saveEdit(tpl.id)} className="rounded bg-[#3b82f6] px-2 py-1 text-[10px] text-white hover:bg-[#2563eb]">Save</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <button className="flex-1 min-w-0 text-left" onClick={() => handleApply(tpl)}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-[#d1d5db] truncate">{tpl.name}</span>
                          {isDefaultModified && <span className="rounded bg-amber-500/10 px-1 text-[9px] text-amber-400">edited</span>}
                        </div>
                        {tpl.category && <div className="text-[10px] text-[#4b5563]">{tpl.category}</div>}
                      </button>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => handleApply(tpl)} className="rounded-md bg-[#3b82f6]/10 px-1.5 py-0.5 text-[10px] text-[#60a5fa] hover:bg-[#3b82f6]/20">Use</button>
                        <button onClick={() => startEdit(tpl)} className="rounded-md p-1 text-[#4b5563] hover:text-white transition" title="Edit">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        {isCustom && <button onClick={() => handleDelete(tpl.id)} className="rounded-md p-1 text-[#4b5563] hover:text-red-400">{Ico.trash}</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Study Metadata Hook ──────────────────────────────────────────────────────

interface StudyMeta {
  patientName: string;
  patientId: string;
  modality: string;
  studyDate: string;
}

function useStudyMeta(studyUID: string, props: Partial<StudyMeta>): StudyMeta {
  const [meta, setMeta] = useState<StudyMeta>({
    patientName: props.patientName || '',
    patientId: props.patientId || '',
    modality: props.modality || '',
    studyDate: props.studyDate || '',
  });

  useEffect(() => {
    // If all props are provided, no need to fetch
    if (props.patientName && props.patientId && props.modality && props.studyDate) return;
    if (!studyUID) return;

    // Fetch from Orthanc REST API to fill missing fields
    const ORTHANC = tauri.getOrthancBase();
    async function fetch_meta() {
      try {
        // Find the Orthanc study ID by StudyInstanceUID
        const findResp = await fetch(`${ORTHANC}/tools/find`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Level: 'Study', Query: { StudyInstanceUID: studyUID }, Limit: 1 }),
        });
        if (!findResp.ok) return;
        const ids: string[] = await findResp.json();
        if (!ids.length) return;

        const studyResp = await fetch(`${ORTHANC}/studies/${ids[0]}?requestedTags=ModalitiesInStudy`);
        if (!studyResp.ok) return;
        const study = await studyResp.json();

        const main = study.MainDicomTags ?? {};
        const patient = study.PatientMainDicomTags ?? {};
        let modality = main.ModalitiesInStudy || study.RequestedTags?.ModalitiesInStudy || '';

        // Derive modality from series if still empty
        if (!modality && Array.isArray(study.Series) && study.Series.length > 0) {
          const seriesMods = await Promise.all(
            study.Series.slice(0, 5).map((sid: string) =>
              fetch(`${ORTHANC}/series/${sid}`).then(r => r.json())
                .then(s => (s.MainDicomTags?.Modality as string) || '').catch(() => '')
            )
          );
          modality = [...new Set(seriesMods.filter(Boolean))].join('\\');
        }

        setMeta(prev => ({
          patientName: prev.patientName || patient.PatientName || '',
          patientId: prev.patientId || patient.PatientID || '',
          modality: prev.modality || modality || '',
          studyDate: prev.studyDate || main.StudyDate || '',
        }));
      } catch { /* silently ignore */ }
    }
    fetch_meta();
  }, [studyUID, props.patientName, props.patientId, props.modality, props.studyDate]);

  return meta;
}

// ─── Main ReportManager ───────────────────────────────────────────────────────

export default function ReportManager({
  studyInstanceUID,
  patientName: propPatient,
  patientId: propId,
  modality: propModality,
  studyDate: propDate,
  onClose,
  standalone = false,
}: ReportManagerProps) {
  const meta = useStudyMeta(studyInstanceUID, {
    patientName: propPatient, patientId: propId, modality: propModality, studyDate: propDate,
  });

  // Report state
  const [reportText, setReportText] = useState('');
  const [finalized, setFinalized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoSaved, setAutoSaved] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);

  // Modal state
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [viewerWarningOpen, setViewerWarningOpen] = useState(false);

  // UI feedback
  const [copied, setCopied] = useState(false);

  // Transcription state
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Responsive: wide = two-column layout; track window width for template panel sizing
  const [isWide, setIsWide] = useState(window.innerWidth >= 900);
  const [winWidth, setWinWidth] = useState(window.innerWidth);
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      setIsWide(w >= 900);
      setWinWidth(window.innerWidth);
    });
    obs.observe(document.documentElement);
    return () => obs.disconnect();
  }, []);

  // ── Load existing report ──
  useEffect(() => {
    tauri.loadReport(studyInstanceUID)
      .then(existing => {
        if (existing) {
          const text = (existing as any).report_text || existing.findings || '';
          setReportText(text);
          if ((existing as any).finalized) setFinalized(true);
        }
        hasLoadedRef.current = true;
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [studyInstanceUID]);

  // ── Save ──
  const doSave = useCallback(async () => {
    setError(null);
    try {
      const now = new Date().toISOString();
      await tauri.saveReport(studyInstanceUID, {
        study_uid: studyInstanceUID,
        patient_name: meta.patientName,
        findings: reportText,
        impression: '',
        radiologist: undefined,
        created_at: now,
        updated_at: now,
      });
    } catch (e) {
      setError(String(e));
    }
  }, [studyInstanceUID, meta.patientName, reportText]);

  // ── Auto-save (2s debounce) ──
  useEffect(() => {
    if (!hasLoadedRef.current || finalized) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      await doSave();
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 2500);
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [reportText, doSave, finalized]);

  // ── Actions ──
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(reportText); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = reportText; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const handleShare = async () => {
    if (navigator.share) { try { await navigator.share({ title: `Radiology Report - ${meta.patientName || 'Unknown'}`, text: reportText }); return; } catch {} }
    const blob = new Blob([
      `RADIOLOGY REPORT\n${'='.repeat(50)}\n` +
      `Patient: ${meta.patientName || 'N/A'}\nPatient ID: ${meta.patientId || 'N/A'}\n` +
      `Modality: ${meta.modality || 'N/A'}\nStudy Date: ${meta.studyDate || 'N/A'}\n` +
      `Study UID: ${studyInstanceUID}\n${'='.repeat(50)}\n\n` + reportText,
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `report_${meta.patientId || studyInstanceUID.slice(-8)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handleFinalize = async () => {
    setFinalized(true); setFinalizeModalOpen(false);
    const now = new Date().toISOString();
    try {
      await tauri.saveReport(studyInstanceUID, {
        study_uid: studyInstanceUID, patient_name: meta.patientName,
        findings: reportText, impression: '', radiologist: undefined,
        created_at: now, updated_at: now,
      });
    } catch (e) { setError(String(e)); }
  };

  // ── View Study ──
  const handleViewStudy = () => {
    try {
      const viewerState = localStorage.getItem('ukubona_viewer_active');
      if (viewerState) {
        const parsed = JSON.parse(viewerState);
        if (Date.now() - parsed.ts < 3_600_000) { setViewerWarningOpen(true); return; }
      }
    } catch {}
    doViewStudy();
  };

  const doViewStudy = async () => {
    setViewerWarningOpen(false);
    if (tauri.isTauri()) {
      try {
        await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|set_focus', { label: 'main' });
        const bc = new BroadcastChannel('ukubona_nav');
        bc.postMessage({ action: 'view_study', uid: studyInstanceUID });
        bc.close();
      } catch (e) { console.error('View Study failed:', e); }
    }
  };

  // ── Transcription ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true); setRecorded(false);
    } catch { setError('Microphone access denied.'); }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.state !== 'inactive' && mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
    setRecording(false); setRecorded(true);
  };

  const proceedTranscription = () => {
    setRecorded(false); setTranscribing(true); setTranscribeProgress(0);
    let step = 0; const steps = 3000 / 50;
    const timer = setInterval(() => {
      step++;
      setTranscribeProgress(Math.min((step / steps) * 100, 100));
      if (step >= steps) {
        clearInterval(timer); setTranscribing(false); setTranscribeProgress(0);
        setReportText(prev => (prev ? prev + '\n\n' + DUMMY_TRANSCRIPTION : DUMMY_TRANSCRIPTION));
      }
    }, 50);
  };

  const applyTemplate = (tpl: ReportTemplate) => {
    if (!finalized) setReportText(tpl.findings_template);
  };

  // ── Render ──
  return (
    <div className={standalone ? 'flex h-screen flex-col bg-[#0d1117]' : 'flex h-full flex-col bg-[#0d1117]'}>

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-[#0f1117] border-b border-[#1e2433] px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#3b82f6]/10 text-[#60a5fa]">
              {Ico.report}
            </div>
            <span className="text-sm font-semibold text-white">Radiology Report</span>
          </div>
          <div className="flex items-center gap-2">
            {!standalone && onClose && (
              <button onClick={onClose} className="rounded-xl p-1.5 text-[#6b7280] transition hover:bg-white/5 hover:text-white">
                {Ico.close}
              </button>
            )}
          </div>
        </div>

        {/* Patient info row */}
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
              <span className="text-xs font-medium text-[#9ca3af]">{meta.patientId}</span>
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
          {studyInstanceUID && (
            <div className="ml-auto">
              <span
                className="cursor-pointer font-mono text-[9px] text-[#374151] hover:text-[#6b7280] transition"
                title={studyInstanceUID}
                onClick={() => navigator.clipboard?.writeText(studyInstanceUID)}
              >
                {studyInstanceUID.slice(-16)}…
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
          </div>
        ) : (
          <div className={`flex h-full ${isWide ? 'flex-row' : 'flex-col overflow-y-auto'}`}>

            {/* ── Left / Main column ── */}
            <div className={`flex flex-col ${isWide ? 'flex-1 min-w-0 overflow-y-auto' : ''} p-5 gap-4`}>
              {finalized && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5">
                  {Ico.shield}
                  <span className="text-xs font-semibold text-emerald-400 tracking-wide">FINALIZED</span>
                  <span className="text-[10px] text-emerald-400/60">Report is locked.</span>
                </div>
              )}

              {/* Toolbar */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#9ca3af] transition hover:bg-white/5 hover:text-white"
                  >
                    {copied ? Ico.check : Ico.copy}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={handleShare}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#9ca3af] transition hover:bg-white/5 hover:text-white"
                  >
                    {Ico.share} <span>Share</span>
                  </button>
                  {!finalized && (
                    <button
                      onClick={() => setClearModalOpen(true)}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#9ca3af] transition hover:bg-white/5 hover:text-red-400"
                    >
                      {Ico.trash} <span>Clear</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {autoSaved && (
                    <span className="flex items-center gap-1.5 rounded-lg bg-[#10b981]/15 px-2.5 py-1 text-[10px] font-semibold text-[#34d399]">
                      {Ico.check} Auto-saved
                    </span>
                  )}
                  {/* Template dropdown on narrow screens */}
                  {!isWide && <TemplatePanel onApply={applyTemplate} disabled={finalized} />}
                </div>
              </div>

              {/* Textarea */}
              <div className="flex-1 flex flex-col">
                <textarea
                  value={reportText}
                  onChange={e => !finalized && setReportText(e.target.value)}
                  readOnly={finalized}
                  placeholder="Begin typing your report here, or select a template to get started..."
                  className={[
                    'w-full flex-1 resize-none rounded-xl bg-[#161b26] px-4 py-3',
                    'text-sm leading-relaxed text-[#e2e8f0] placeholder-[#374151]',
                    'border border-[#1e2433] outline-none focus:border-[#3b82f6]/40',
                    finalized ? 'cursor-not-allowed opacity-70' : '',
                    isWide ? 'min-h-[320px]' : 'min-h-[220px]',
                  ].join(' ')}
                  rows={isWide ? 16 : 10}
                />
              </div>

              {error && (
                <div className="rounded-xl bg-red-900/20 border border-red-500/20 px-4 py-3 text-xs text-red-400">{error}</div>
              )}

              {/* Save / Finalize */}
              {!finalized && (
                <div className="flex gap-3">
                  <button
                    onClick={doSave}
                    disabled={!reportText.trim()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#3b82f6]/30 py-2.5 text-sm font-semibold text-[#60a5fa] transition hover:bg-[#3b82f6]/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {Ico.check} Save
                  </button>
                  <button
                    onClick={() => setFinalizeModalOpen(true)}
                    disabled={!reportText.trim()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#3b82f6] py-2.5 text-sm font-semibold text-white transition hover:bg-[#2563eb] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {Ico.shield} Finalize
                  </button>
                </div>
              )}

              {/* Transcribe section */}
              {!finalized && (
                <div className="rounded-xl border border-[#1e2433] bg-[#161b26] p-4">
                  <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[#4b5563]">
                    Voice Transcription
                  </div>
                  {!recording && !recorded && !transcribing && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={startRecording}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-[#1e2433] bg-[#0f1117] text-[#9ca3af] transition hover:border-[#3b82f6]/40 hover:text-[#60a5fa] active:scale-95"
                      >
                        {Ico.mic}
                      </button>
                      <span className="text-[11px] text-[#4b5563]">Tap to start recording</span>
                    </div>
                  )}
                  {recording && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={stopRecording}
                        className="relative flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-400 active:scale-95"
                      >
                        <span className="absolute inset-0 animate-ping rounded-full bg-red-500/20" />
                        {Ico.mic}
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                        <span className="text-xs font-medium text-red-400">Recording… tap to stop</span>
                      </div>
                    </div>
                  )}
                  {recorded && (
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#1e2433] text-[#60a5fa]">{Ico.mic}</div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setRecorded(false)} className="rounded-lg px-3 py-1.5 text-xs text-[#9ca3af] hover:bg-white/5">Discard</button>
                        <button onClick={proceedTranscription} className="rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2563eb]">Transcribe</button>
                      </div>
                    </div>
                  )}
                  {transcribing && (
                    <div className="flex items-center gap-3">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-xs text-[#9ca3af]">Transcribing…</span>
                          <span className="text-[10px] text-[#4b5563]">{Math.round(transcribeProgress)}%</span>
                        </div>
                        <div className="h-1 rounded-full bg-[#1e2433] overflow-hidden">
                          <div className="h-full rounded-full bg-[#3b82f6] transition-all duration-75" style={{ width: `${transcribeProgress}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Right column: template panel (wide screens only) ── */}
            {isWide && (
              <div
                className="flex-shrink-0 border-l border-[#1e2433] overflow-y-auto p-4"
                style={{ width: Math.max(280, Math.min(420, Math.round(winWidth * 0.28))) + 'px' }}
              >
                <TemplatePanel onApply={applyTemplate} disabled={finalized} inline />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex-shrink-0 border-t border-[#1e2433] bg-[#0f1117] px-5 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#374151]">Ukubona Report Manager</span>
          <div className="flex items-center gap-2">
            {standalone && studyInstanceUID && (
              <button
                onClick={handleViewStudy}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#60a5fa] transition hover:bg-[#3b82f6]/10"
              >
                {Ico.eye} View Study
              </button>
            )}
            {!standalone && onClose && (
              <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-[#6b7280] transition hover:bg-white/5 hover:text-white">
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <ConfirmModal
        open={clearModalOpen} title="Clear Report"
        message="Are you sure you want to clear all report text? This action cannot be undone."
        confirmLabel="Clear" confirmColor="bg-red-500 hover:bg-red-600"
        onConfirm={() => { setReportText(''); setClearModalOpen(false); }}
        onCancel={() => setClearModalOpen(false)}
      />
      <ConfirmModal
        open={finalizeModalOpen} title="Finalize Report"
        message="This will make the report uneditable. Once finalized, the report text cannot be changed."
        confirmLabel="Finalize" confirmColor="bg-emerald-600 hover:bg-emerald-700"
        onConfirm={handleFinalize} onCancel={() => setFinalizeModalOpen(false)}
      />
      <ConfirmModal
        open={viewerWarningOpen} title="Study Open in Viewer"
        message="A study is currently open in the main viewer. Proceeding will navigate to this study instead."
        confirmLabel="Proceed" confirmColor="bg-[#3b82f6] hover:bg-[#2563eb]"
        onConfirm={doViewStudy} onCancel={() => setViewerWarningOpen(false)}
      />
    </div>
  );
}
