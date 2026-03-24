import React, { useState } from 'react';
import ReportManager from './ReportManager';
import { isTauri, openTauriWindow } from '../tauriBridge';

interface ReportButtonProps {
  studyInstanceUID: string;
  patientName?: string;
}

function ReportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

export default function ReportButton({ studyInstanceUID, patientName }: ReportButtonProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  const handleClick = async () => {
    if (isTauri()) {
      const label = `report_${studyInstanceUID.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
      await openTauriWindow(label, {
        url: `/report-manager?uid=${encodeURIComponent(studyInstanceUID)}&name=${encodeURIComponent(patientName ?? '')}`,
        title: `Report${patientName ? ' — ' + patientName : ''}`,
        width: 900,
        height: 680,
        minWidth: 640,
        minHeight: 500,
        center: true,
      });
    } else {
      setPanelOpen(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        title="Radiology Report"
        className={[
          'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium',
          'bg-[#1a2035] text-[#a0aec0] ring-1 ring-white/10',
          'transition hover:bg-[#2d3748] hover:text-white',
          'focus:outline-none focus:ring-2 focus:ring-[#63b3ed]/40',
        ].join(' ')}
      >
        <ReportIcon />
        <span>Report</span>
      </button>

      {panelOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/40 backdrop-blur-sm"
            onClick={() => setPanelOpen(false)}
          />
          <div className="flex w-[480px] flex-shrink-0 flex-col border-l border-white/10 bg-[#0d1117] shadow-2xl">
            <ReportManager
              studyInstanceUID={studyInstanceUID}
              patientName={patientName}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
