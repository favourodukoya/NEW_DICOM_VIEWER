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

const POPUP_PATHS = ['/report-manager', '/ai-panel', '/settings-panel', '/pacs-study-list'];

const ukubonaExtension = {
  id,
  getToolbarModule,
  getCustomizationModule,
  preRegistration({ servicesManager, commandsManager, appConfig }: withAppTypes) {
    if (typeof window === 'undefined') return;

    const isPopupWindow = POPUP_PATHS.some(p => window.location.pathname.startsWith(p));

    if (isPopupWindow) {
      // Popup windows must not react to main-window nav events
      return;
    }

    // ── Cross-window navigation (View Study from report/AI windows) ────────────
    // When the viewer is active, StudyCardGrid is unmounted and can't receive BC
    // messages. This handler stores the pending UID and hard-navigates to root so
    // StudyCardGrid picks it up on mount.
    const bc = new BroadcastChannel('ukubona_nav');
    bc.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.action === 'view_study' && e.data?.uid) {
        const uid = e.data.uid as string;
        const isAtRoot = window.location.pathname === '/' || window.location.pathname === '';
        if (!isAtRoot) {
          try { localStorage.setItem('ukubona_pending_view', uid); } catch {}
          window.location.href = '/';
        }
        // At root: StudyCardGrid's own BC listener handles it directly
      }
    });
    // Do NOT close this BC — it must stay open for the app lifetime

    // ── Main window close-requested: warn if popup windows are open ────────────
    // Tauri v2: listen for the close-requested event, show a confirm dialog,
    // close all popup windows, then allow the app to exit.
    const tauri = (window as any).__TAURI_INTERNALS__;
    if (!tauri) return; // not in Tauri, skip

    tauri.invoke('plugin:event|listen', {
      event: 'tauri://close-requested',
      handler: '__ukubona_close_handler__',
    }).catch(() => {
      // Fallback: use __TAURI_INTERNALS__.listen if available
    });

    // Use the Tauri event plugin API properly
    try {
      // Tauri v2 exposes window.__TAURI__ for plugins in some configs
      // We use the internals listen via dynamic import to avoid bundler issues
      setupCloseHandler(tauri);
    } catch {
      // ignore if not available
    }
  },
};

/**
 * Sets up the main window close-requested interceptor.
 * Checks for open popup windows; if present, prompts the user before closing everything.
 */
async function setupCloseHandler(tauri: any) {
  try {
    // Get the plugin:event|listen command available in Tauri v2
    const unlisten = await tauri.invoke('plugin:event|listen', {
      event: 'tauri://close-requested',
      target: { kind: 'Window', label: 'main' },
    }).catch(() => null);

    // Alternative: use @tauri-apps/api/event style via internals
    // Tauri v2 exposes window.addEventListener for tauri events too
    window.addEventListener('tauri://close-requested', async (event: Event) => {
      event.preventDefault();

      try {
        // Check for open popup windows
        const windows: any[] = await tauri.invoke('plugin:window|get_all_windows').catch(() => []);
        const labels: string[] = (windows ?? []).map((w: any) => w.label ?? w);
        const hasPopups = labels.some(
          (l: string) => l.startsWith('report_') || l.startsWith('ai_') || l.startsWith('settings_')
        );

        if (hasPopups) {
          // Show a native confirm dialog
          const confirmed = await tauri.invoke('plugin:dialog|ask', {
            title: 'Close Ukubona Viewer',
            message: 'You have open report or AI windows. Closing will also close all popup windows. Continue?',
            kind: 'warning',
          }).catch(() => true); // if dialog fails, allow close

          if (!confirmed) return; // user cancelled

          // Close all popup windows
          for (const label of labels) {
            if (label.startsWith('report_') || label.startsWith('ai_') || label.startsWith('settings_')) {
              await tauri.invoke('plugin:window|close', { label }).catch(() => {});
            }
          }
        }

        // Proceed with closing the main window
        await tauri.invoke('plugin:window|close', { label: 'main' }).catch(() => {});
      } catch {
        // If anything fails, fall through and allow the OS to close the window
        await tauri.invoke('plugin:window|close', { label: 'main' }).catch(() => {});
      }
    });
  } catch {
    // Not in Tauri or event API not available — ignore
  }
}

export default ukubonaExtension;
