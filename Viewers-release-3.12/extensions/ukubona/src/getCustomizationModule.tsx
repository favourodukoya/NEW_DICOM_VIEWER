import React, { useState } from 'react';
import StudyCardGrid from './components/StudyCardGrid';
import ReportManager from './components/ReportManager';
import UkubonaAIModal from './components/UkubonaAIModal';
import SettingsPage from './components/SettingsPage';
import PacsStudyList from './components/PacsStudyList';
import { isAuthenticated } from './components/LoginPage';

/** Parse query params from the current URL synchronously (works with BrowserRouter). */
function useQueryParams() {
  const [params] = useState<Record<string, string>>(() => {
    const p = new URLSearchParams(window.location.search);
    const result: Record<string, string> = {};
    p.forEach((v, k) => (result[k] = v));
    return result;
  });
  return params;
}

/**
 * Standalone report manager page.
 * Opened as a new Tauri window via: /report-manager?uid=...&name=...&pid=...&mod=...&date=...
 */
function ReportManagerPage() {
  const params = useQueryParams();
  const uid = params.uid ?? '';
  const name = params.name ?? '';
  const pid = params.pid ?? '';
  const mod = params.mod ?? '';
  const date = params.date ?? '';

  if (!uid) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0d1117] text-[#4a5568] text-sm">
        No study selected.
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0d1117]">
      <ReportManager
        studyInstanceUID={uid}
        patientName={name || undefined}
        patientId={pid || undefined}
        modality={mod || undefined}
        studyDate={date || undefined}
        standalone
      />
    </div>
  );
}

/**
 * Standalone AI analysis page.
 * Opened as a new Tauri window via: /ai-panel?uid=...&series=...&name=...&mod=...&date=...
 */
function AIPage() {
  const params = useQueryParams();
  const uid = params.uid ?? '';
  const series = params.series ?? '';
  const name = params.name ?? '';
  const pid = params.pid ?? '';
  const mod = params.mod ?? '';
  const date = params.date ?? '';

  if (!uid) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0d1117] text-[#4a5568] text-sm">
        No study selected.
      </div>
    );
  }

  if (!isAuthenticated()) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#0d1117]">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <p className="text-sm text-[#9ca3af]">Please sign in to use Ukubona AI</p>
        <p className="text-xs text-[#4b5563]">Close this window and sign in first</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0d1117]">
      <UkubonaAIModal
        studyInstanceUID={uid}
        seriesInstanceUID={series || undefined}
        patientName={name || undefined}
        patientId={pid || undefined}
        modality={mod || undefined}
        studyDate={date || undefined}
        onClose={() => window.close()}
      />
    </div>
  );
}

/**
 * Standalone settings page.
 * Opened as a new Tauri window via: /settings-panel
 */
function SettingsPageStandalone() {
  return (
    <div className="h-screen bg-[#0d1117]">
      <SettingsPage onClose={() => window.close()} standalone />
    </div>
  );
}

/**
 * Registers the custom card-based worklist and standalone page routes.
 */
export default function getCustomizationModule() {
  return [
    {
      name: 'global',
      value: {
        'routes.customRoutes': {
          routes: [
            {
              path: '/',
              children: (props: Record<string, unknown>) => (
                <StudyCardGrid
                  dataPath="/orthanc"
                  {...props}
                />
              ),
              private: true,
            },
            {
              path: '/report-manager',
              children: () => <ReportManagerPage />,
              private: false,
            },
            {
              path: '/ai-panel',
              children: () => <AIPage />,
              private: false,
            },
            {
              path: '/settings-panel',
              children: () => <SettingsPageStandalone />,
              private: false,
            },
            {
              path: '/pacs-study-list',
              children: () => <PacsStudyList />,
              private: false,
            },
          ],
        },
      },
    },
  ];
}
