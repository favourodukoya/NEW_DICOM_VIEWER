import React, { useState } from 'react';

export interface ViewerMode {
  id: string;
  label: string;
  description: string;
  route: string;
  dataPath: string;
  /** Modalities this mode supports. Empty = any modality. */
  modalities: string[];
  icon: React.ReactNode;
  /** Short label shown under the icon tile (2–3 words max) */
  shortLabel: string;
  /** Accent colour for the icon background tint */
  color: string;
}

const VIEWER_MODES: ViewerMode[] = [
  {
    id: 'basic',
    label: 'Basic Viewer',
    shortLabel: 'Basic',
    description: 'Standard DICOM viewer with measurements, annotations, and windowing.',
    route: 'basic',
    dataPath: '/orthanc',
    modalities: [],
    color: '#3b82f6',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <circle cx="12" cy="10" r="3" strokeDasharray="2 1.2" />
      </svg>
    ),
  },
  {
    id: 'segmentation',
    label: 'Segmentation',
    shortLabel: 'Segmentation',
    description: 'Volumetric segmentation and 3D organ/lesion analysis for CT, MR, PET, NM and US.',
    route: 'segmentation',
    dataPath: '/orthanc',
    modalities: ['CT', 'MR', 'PT', 'PET', 'NM', 'US'],
    color: '#10b981',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: 'mpr',
    label: 'MPR / 3D',
    shortLabel: 'MPR / 3D',
    description: 'Multi-planar reconstruction and 3D volume rendering for cross-sectional studies.',
    route: 'basic',
    dataPath: '/orthanc',
    modalities: ['CT', 'MR', 'PT', 'PET', 'NM'],
    color: '#8b5cf6',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 2L2 12l10 10 10-10L12 2z" />
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    ),
  },
  {
    id: 'tmtv',
    label: 'TMTV (PET/CT)',
    shortLabel: 'TMTV',
    description: 'Total Metabolic Tumour Volume analysis for PET/CT fusion studies.',
    route: 'tmtv',
    dataPath: '/orthanc',
    modalities: ['PT', 'PET'],
    color: '#f59e0b',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3c0 0-3.5 4-3.5 9s3.5 9 3.5 9" />
        <path d="M3 12h18" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: 'microscopy',
    label: 'Microscopy',
    shortLabel: 'Microscopy',
    description: 'Whole-slide image viewer for digital pathology (SM modality).',
    route: 'microscopy',
    dataPath: '/orthanc',
    modalities: ['SM'],
    color: '#06b6d4',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="9" r="4" />
        <line x1="12" y1="13" x2="12" y2="20" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="5" x2="12" y2="2" />
        <path d="M8.5 6L7 4.5M15.5 6L17 4.5" />
      </svg>
    ),
  },
  {
    id: 'sr',
    label: 'Structured Report',
    shortLabel: 'Report',
    description: 'View DICOM Structured Reports and encapsulated documents.',
    route: 'basic',
    dataPath: '/orthanc',
    modalities: ['SR', 'DOC'],
    color: '#64748b',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    ),
  },
];

export function getApplicableModes(modalities: string): ViewerMode[] {
  if (!modalities) return [VIEWER_MODES[0]];
  const mods = modalities
    .toUpperCase()
    .split(/[\\,/\s]+/)
    .map(m => m.trim())
    .filter(Boolean);
  return VIEWER_MODES.filter(
    mode => mode.modalities.length === 0 || mode.modalities.some(m => mods.includes(m))
  );
}

interface ModeSelectModalProps {
  studyInstanceUID: string;
  modalities: string;
  patientName?: string;
  onSelect: (mode: ViewerMode) => void;
  onClose: () => void;
}

export default function ModeSelectModal({
  modalities,
  patientName,
  onSelect,
  onClose,
}: ModeSelectModalProps) {
  const modes = getApplicableModes(modalities);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredMode = modes.find(m => m.id === hoveredId) ?? modes[0];

  const displayMods = modalities
    ? modalities.split(/[\\,/\s]+/).filter(Boolean).join(' · ')
    : '';

  // Single-mode: skip modal, but the caller handles this — here we always render.
  // Grid columns: 3 for ≤4 modes, else up to 3 cols wrapping naturally.
  const cols = modes.length <= 2 ? modes.length : 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl border border-[#1e2433] bg-[#0d1117] shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Open Study</h2>
            {(patientName || displayMods) && (
              <p className="mt-0.5 text-[11px] text-[#6b7280]">
                {patientName && <span>{patientName}</span>}
                {patientName && displayMods && <span className="mx-1.5 opacity-30">·</span>}
                {displayMods && <span className="font-medium text-[#9ca3af]">{displayMods}</span>}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 rounded-lg p-1 text-[#4b5563] transition hover:bg-white/5 hover:text-[#9ca3af]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Mode icon grid ── */}
        <div className="px-4 pb-2">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {modes.map(mode => {
              const isHovered = hoveredId === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() => onSelect(mode)}
                  onMouseEnter={() => setHoveredId(mode.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={[
                    'group relative flex flex-col items-center gap-2 rounded-xl px-2 py-3.5 transition-all duration-150',
                    isHovered
                      ? 'bg-[#161b26]'
                      : 'hover:bg-[#161b26]',
                  ].join(' ')}
                >
                  {/* Icon circle */}
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-150 group-hover:scale-105"
                    style={{
                      backgroundColor: `${mode.color}18`,
                      color: mode.color,
                      boxShadow: isHovered ? `0 0 0 1px ${mode.color}30` : 'none',
                    }}
                  >
                    {mode.icon}
                  </div>
                  {/* Label */}
                  <span className="text-center text-[11px] font-medium leading-tight text-[#9ca3af] group-hover:text-white transition-colors">
                    {mode.shortLabel}
                  </span>
                  {/* Active indicator dot */}
                  <span
                    className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-0.5 rounded-full transition-all duration-150"
                    style={{
                      width: isHovered ? '20px' : '0px',
                      backgroundColor: mode.color,
                      opacity: isHovered ? 1 : 0,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Description strip ── */}
        <div className="mx-4 mb-4 mt-1 min-h-[48px] rounded-xl bg-[#161b26] px-4 py-3 transition-all duration-150">
          <p className="text-[11px] font-semibold" style={{ color: hoveredMode.color }}>
            {hoveredMode.label}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#6b7280]">
            {hoveredMode.description}
          </p>
        </div>

      </div>
    </div>
  );
}
