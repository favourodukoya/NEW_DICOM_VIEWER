import React from 'react';

export interface ViewerMode {
  id: string;
  label: string;
  description: string;
  route: string;      // e.g. "viewer"
  dataPath: string;   // e.g. "/dicomweb"
  /** Modalities this mode supports. Empty = any. */
  modalities: string[];
  icon: React.ReactNode;
}

const VIEWER_MODES: ViewerMode[] = [
  {
    id: 'basic',
    label: 'Basic Viewer',
    description: 'Standard DICOM viewer with measurement and annotation tools.',
    route: 'basic',
    dataPath: '/orthanc',
    modalities: [],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <circle cx="12" cy="10" r="3" strokeDasharray="2 1" />
      </svg>
    ),
  },
  {
    id: 'segmentation',
    label: 'Segmentation',
    description: 'Volumetric segmentation and 3D analysis for CT, MR and PET.',
    route: 'segmentation',
    dataPath: '/orthanc',
    modalities: ['CT', 'MR', 'PT', 'NM', 'PET'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
];

/** Returns the modes applicable for a given modalities string (e.g. "CT\\MR" or "CT"). */
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
  studyInstanceUID,
  modalities,
  patientName,
  onSelect,
  onClose,
}: ModeSelectModalProps) {
  const modes = getApplicableModes(modalities);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#111827] shadow-2xl ring-1 ring-white/10">
        {/* Header */}
        <div className="border-b border-white/5 px-6 py-4">
          <h2 className="text-base font-semibold text-white">Open Study</h2>
          <p className="mt-0.5 text-xs text-[#718096]">
            {patientName ? `${patientName} · ` : ''}
            {modalities && <span className="font-medium text-[#a0aec0]">{modalities}</span>}
          </p>
        </div>

        {/* Mode cards */}
        <div className="flex flex-col gap-2 p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#4a5568]">
            Select viewer mode
          </p>
          {modes.map(mode => (
            <button
              key={mode.id}
              onClick={() => onSelect(mode)}
              className="flex items-center gap-4 rounded-xl border border-white/5 bg-[#1a2035] p-4 text-left transition-all hover:border-[#63b3ed]/40 hover:bg-[#1e2a45] hover:shadow-md"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#0d1117] text-[#63b3ed]">
                {mode.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{mode.label}</div>
                <div className="mt-0.5 text-xs text-[#718096]">{mode.description}</div>
              </div>
              <svg
                className="ml-auto flex-shrink-0 text-[#4a5568]"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>

        <div className="flex justify-end border-t border-white/5 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm text-[#718096] hover:bg-white/5 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
