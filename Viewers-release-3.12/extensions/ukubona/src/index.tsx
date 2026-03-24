import { id } from './id';
import getToolbarModule from './getToolbarModule';
import getCustomizationModule from './getCustomizationModule';

export { default as StudyCard } from './components/StudyCard';
export { default as StudyCardGrid } from './components/StudyCardGrid';
export { default as UploadZone } from './components/UploadZone';
export { default as UkubonaAIModal } from './components/UkubonaAIModal';
export { default as UkubonaAIButton } from './components/UkubonaAIButton';
export { default as ReportManager } from './components/ReportManager';
export { default as ReportButton } from './components/ReportButton';
export { default as SettingsPage } from './components/SettingsPage';
export { default as LoginPage } from './components/LoginPage';
export { default as ModeSelectModal } from './components/ModeSelectModal';
export * as tauriBridge from './tauriBridge';

const ukubonaExtension = {
  id,
  getToolbarModule,
  getCustomizationModule,
  preRegistration({ servicesManager, commandsManager, appConfig }: withAppTypes) {
    // Global BroadcastChannel listener for cross-window navigation (e.g. "View Study" from report/AI windows).
    // When the viewer is active, StudyCardGrid is unmounted and can't receive BC messages directly.
    // This handler detects that case, stores the pending UID, and navigates to the root so StudyCardGrid can pick it up.
    if (typeof window !== 'undefined') {
      const bc = new BroadcastChannel('ukubona_nav');
      bc.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.action === 'view_study' && e.data?.uid) {
          const uid = e.data.uid as string;
          const isAtRoot = window.location.pathname === '/' || window.location.pathname === '';
          if (!isAtRoot) {
            // Viewer (or another page) is active — navigate home with pending UID
            try { localStorage.setItem('ukubona_pending_view', uid); } catch {}
            window.location.href = '/';
          }
          // If already at root, StudyCardGrid's own BC listener handles it directly
        }
      });
      // Do NOT close this BC — it must stay open for the app lifetime
    }
  },
};

export default ukubonaExtension;
