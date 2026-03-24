import React, { useState, useEffect, useRef } from 'react';
import { getOrthancBase, isTauri, openTauriWindow } from '../tauriBridge';
import { getApplicableModes, ViewerMode } from './ModeSelectModal';

interface StudyCardProps {
  studyInstanceUid: string;
  patientName: string;
  patientId?: string;
  studyDescription?: string;
  studyDate?: string;
  modalities?: string;
  seriesCount?: number;
  instanceCount?: number;
  onClick: () => void;
  onOpenMode?: (mode: ViewerMode) => void;
  onDelete?: () => void;
  onOpenReport?: () => void;
  onOpenAI?: () => void;
  isLoading?: boolean;
}

function ThumbnailImage({ studyInstanceUid }: { studyInstanceUid: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadThumbnail() {
      try {
        const findResp = await fetch(`${getOrthancBase()}/tools/find`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Level: 'Instance',
            Query: { StudyInstanceUID: studyInstanceUid },
            Limit: 1,
          }),
        });

        if (!findResp.ok) return;
        const ids: string[] = await findResp.json();
        if (ids.length === 0) return;

        const thumbResp = await fetch(
          `${getOrthancBase()}/instances/${ids[0]}/preview`,
        );
        if (!thumbResp.ok) return;

        const blob = await thumbResp.blob();
        if (!cancelled) setSrc(URL.createObjectURL(blob));
      } catch {
        if (!cancelled) setError(true);
      }
    }
    loadThumbnail();
    return () => {
      cancelled = true;
    };
  }, [studyInstanceUid]);

  if (error || !src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0f1117]">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2a3040" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="Study thumbnail"
      className="h-full w-full object-cover"
      onError={() => setError(true)}
    />
  );
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const clean = dateStr.replace(/\D/g, '');
  if (clean.length === 8) {
    return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
  }
  return dateStr;
}

// ─── Context Menu ───────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  studyInstanceUid: string;
  patientName?: string;
  onClose: () => void;
  onOpenReport?: () => void;
  onOpenAI?: () => void;
  onDelete?: () => void;
  modes: ViewerMode[];
  onOpenMode?: (mode: ViewerMode) => void;
}

function ContextMenu({ x, y, studyInstanceUid, patientName, onClose, onOpenReport, onOpenAI, onDelete, modes, onOpenMode }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  };

  return (
    <div ref={ref} style={style} className="min-w-[180px] rounded-lg border border-[#1e2433] bg-[#161b26] py-1 shadow-xl">
      {/* Open in viewer modes */}
      {modes.map(mode => (
        <button
          key={mode.id}
          onClick={() => { onClose(); onOpenMode?.(mode); }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#d1d5db] hover:bg-[#1e2a45]"
        >
          <span className="flex h-4 w-4 items-center justify-center text-[#63b3ed]">{mode.icon}</span>
          Open in {mode.label}
        </button>
      ))}

      {/* Open in New Window (Tauri only) */}
      {isTauri() && modes.length > 0 && (
        <button
          onClick={async () => {
            onClose();
            const mode = modes[0];
            const label = `viewer_${studyInstanceUid.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}_${Date.now()}`;
            await openTauriWindow(label, {
              url: `/${mode.route}${mode.dataPath}?StudyInstanceUIDs=${studyInstanceUid}`,
              title: `${patientName || 'Study'} — ${mode.label}`,
              width: 1200,
              height: 800,
              minWidth: 800,
              minHeight: 600,
            });
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#d1d5db] hover:bg-[#1e2a45]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#63b3ed]">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          Open Study in New Window
        </button>
      )}

      <div className="my-1 h-px bg-[#1e2433]" />

      {/* Report */}
      {onOpenReport && (
        <button
          onClick={() => { onClose(); onOpenReport(); }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#d1d5db] hover:bg-[#1e2a45]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#63b3ed]">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          Open Reporting Tool
        </button>
      )}

      {/* AI */}
      {onOpenAI && (
        <button
          onClick={() => { onClose(); onOpenAI(); }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#d1d5db] hover:bg-[#1e2a45]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-[#3b82f6]">
            <path d="M11 22H2v-9h9zm11 0h-9v-9h9zM11 11H2V2h9zm8.455-6.456L22.68 6l-3.225 1.455L18 10.68l-1.456-3.225L13.32 6l3.224-1.456L18 1.32z" />
          </svg>
          Use Ukubona AI
        </button>
      )}

      <div className="my-1 h-px bg-[#1e2433]" />

      {/* Copy UID */}
      <button
        onClick={() => { navigator.clipboard?.writeText(studyInstanceUid); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#9ca3af] hover:bg-[#1e2a45]"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        Copy Study UID
      </button>

      {/* Delete */}
      {onDelete && (
        <>
          <div className="my-1 h-px bg-[#1e2433]" />
          <button
            onClick={() => { onClose(); onDelete(); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Delete Study
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main Card ──────────────────────────────────────────────────────────────

export default function StudyCard({
  studyInstanceUid,
  patientName,
  patientId,
  studyDescription,
  studyDate,
  modalities,
  seriesCount,
  instanceCount,
  onClick,
  onOpenMode,
  onDelete,
  onOpenReport,
  onOpenAI,
  isLoading,
}: StudyCardProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const modes = getApplicableModes(modalities ?? '');

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={e => e.key === 'Enter' && onClick()}
        onContextMenu={handleContextMenu}
        className={[
          'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl',
          'border border-[#1e2433] bg-[#161b26] transition-all duration-150',
          'hover:border-[#2a3040] hover:bg-[#1a2030]',
          isLoading ? 'opacity-50 pointer-events-none' : '',
        ].join(' ')}
      >
        {/* Thumbnail */}
        <div className="relative h-36 w-full overflow-hidden bg-[#0f1117]">
          <ThumbnailImage studyInstanceUid={studyInstanceUid} />

          {/* Modality badge */}
          {modalities && (
            <div className="absolute top-2 left-2 rounded-md bg-[#1e2433] px-1.5 py-0.5 text-[10px] font-semibold text-[#9ca3af]">
              {modalities.split(/[\\,/\s]+/).filter(Boolean).join('·')}
            </div>
          )}

          {/* Delete button */}
          {onDelete && (
            <button
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
              className="absolute top-2 right-2 hidden rounded-md bg-[#1e2433] p-1 text-[#6b7280] group-hover:flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 transition"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0f1117]/80">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
          <h3 className="truncate text-sm font-medium text-[#e5e7eb]" title={patientName}>
            {patientName || 'Unknown Patient'}
          </h3>

          {studyDescription && (
            <p className="truncate text-xs text-[#6b7280]" title={studyDescription}>
              {studyDescription}
            </p>
          )}

          <div className="mt-auto flex items-center justify-between pt-1.5">
            <span className="text-[11px] text-[#4b5563]">{formatDate(studyDate)}</span>
            <div className="flex items-center gap-1.5 text-[11px] text-[#4b5563]">
              {seriesCount !== undefined && seriesCount > 0 && (
                <span title="Series">{seriesCount}S</span>
              )}
              {instanceCount !== undefined && instanceCount > 0 && (
                <span title="Images">{instanceCount}I</span>
              )}
            </div>
          </div>
        </div>

        {/* Mode buttons — icon-only with tooltip */}
        <div className="flex border-t border-[#1e2433]">
          {modes.map((mode, i) => (
            <button
              key={mode.id}
              onClick={e => { e.stopPropagation(); onOpenMode?.(mode); }}
              title={mode.label}
              className={[
                'group/mb relative flex flex-1 items-center justify-center py-2 text-[#4b5563] transition-colors',
                'hover:bg-[#161b26] hover:text-[#60a5fa]',
                i > 0 ? 'border-l border-[#1e2433]' : '',
              ].join(' ')}
            >
              {/* icon */}
              <span className="flex h-[15px] w-[15px] items-center justify-center [&>svg]:h-[14px] [&>svg]:w-[14px]">
                {mode.icon}
              </span>
              {/* floating tooltip */}
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#1e2433] px-2 py-1 text-[10px] font-medium text-[#e5e7eb] opacity-0 shadow-lg transition-opacity group-hover/mb:opacity-100">
                {mode.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          studyInstanceUid={studyInstanceUid}
          patientName={patientName}
          onClose={() => setCtxMenu(null)}
          onOpenReport={onOpenReport}
          onOpenAI={onOpenAI}
          onDelete={onDelete}
          modes={modes}
          onOpenMode={onOpenMode}
        />
      )}
    </>
  );
}
