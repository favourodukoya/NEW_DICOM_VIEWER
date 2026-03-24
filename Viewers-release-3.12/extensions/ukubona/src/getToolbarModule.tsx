import React, { useEffect } from 'react';
import { isTauri, openTauriWindow } from './tauriBridge';
import { isAuthenticated } from './components/LoginPage';

export default function getToolbarModule({ servicesManager }: withAppTypes) {
  function ViewerToolbarButtons() {
    let studyUID = '';
    let seriesUID = '';
    let patientName = '';
    let modality = '';
    let studyDate = '';
    let patientId = '';

    try {
      const { viewportGridService, displaySetService } = servicesManager.services;
      const { activeViewportId, viewports } = viewportGridService.getState();
      const activeViewport = viewports.get(activeViewportId);
      const displaySetInstanceUID = activeViewport?.displaySetInstanceUIDs?.[0];
      if (displaySetInstanceUID) {
        const ds = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
        studyUID = ds?.StudyInstanceUID ?? '';
        seriesUID = ds?.SeriesInstanceUID ?? '';
        patientName = ds?.PatientName ?? '';
        modality = ds?.Modality ?? '';
        studyDate = ds?.StudyDate ?? '';
        patientId = ds?.PatientID ?? '';
      }
    } catch {
      // silent
    }

    // Set window title to study metadata when viewing (show whatever is available)
    useEffect(() => {
      const parts = [modality, patientName, patientId].filter(Boolean);
      if (parts.length > 0) {
        const title = parts.join(' \u00B7 ') + ' \u2014 Ukubona';
        document.title = title;
        if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
          (window as any).__TAURI_INTERNALS__.invoke('plugin:window|set_title', { label: 'main', title }).catch(() => {});
        }
      }
    }, [patientName, patientId, modality, studyDate]);

    const handleReport = async () => {
      if (!studyUID) return;
      if (isTauri()) {
        const label = `report_${studyUID.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
        await openTauriWindow(label, {
          url: `/report-manager?uid=${encodeURIComponent(studyUID)}&name=${encodeURIComponent(patientName)}&pid=${encodeURIComponent(patientId)}&mod=${encodeURIComponent(modality)}&date=${encodeURIComponent(studyDate)}`,
          title: `Report — ${patientName || 'Study'} — ${modality || ''}`,
          width: 560,
          height: 700,
          minWidth: 560,
          minHeight: 500,
        });
      }
    };

    const handleAI = async () => {
      if (!studyUID) return;
      if (!isAuthenticated()) {
        alert('Please sign in to use Ukubona AI');
        return;
      }
      if (isTauri()) {
        const label = `ai_${studyUID.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
        await openTauriWindow(label, {
          url: `/ai-panel?uid=${encodeURIComponent(studyUID)}&series=${encodeURIComponent(seriesUID)}&name=${encodeURIComponent(patientName)}&mod=${encodeURIComponent(modality)}&date=${encodeURIComponent(studyDate)}`,
          title: `Ukubona AI — ${patientName || 'Study'} — ${modality || ''}`,
          width: 700,
          height: 720,
          minWidth: 560,
          minHeight: 500,
        });
      }
    };

    const handleSettings = async () => {
      if (isTauri()) {
        await openTauriWindow('settings_panel', {
          url: '/settings-panel',
          title: 'Ukubona Settings',
          width: 780,
          height: 600,
          minWidth: 640,
          minHeight: 480,
        });
      }
    };

    return (
      <div className="flex items-center gap-1.5">
        {/* Ukubona AI */}
        <button
          onClick={handleAI}
          title="Run AI Analysis"
          className="flex h-8 min-w-[120px] items-center justify-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 text-xs font-semibold text-white transition-all hover:bg-[#2563eb]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 22H2v-9h9zm11 0h-9v-9h9zM11 11H2V2h9zm8.455-6.456L22.68 6l-3.225 1.455L18 10.68l-1.456-3.225L13.32 6l3.224-1.456L18 1.32z" />
          </svg>
          <span>Ukubona AI</span>
        </button>

        {/* Report */}
        <button
          onClick={handleReport}
          title="Radiology Report"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1a2035] px-3 text-xs font-medium text-[#a0aec0] transition hover:bg-[#2d3748] hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Report</span>
        </button>

        {/* Settings */}
        <button
          onClick={handleSettings}
          title="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#718096] transition hover:bg-white/10 hover:text-white"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>
    );
  }

  return [
    {
      name: 'ukubona.viewerToolbar',
      defaultComponent: ViewerToolbarButtons,
    },
  ];
}
