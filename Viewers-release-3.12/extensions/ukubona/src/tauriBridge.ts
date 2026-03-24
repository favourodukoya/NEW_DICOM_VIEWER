/**
 * Tauri bridge - wraps invoke() with graceful fallback for browser dev mode.
 * All backend communication goes through here.
 *
 * NOTE: Tauri v2 `#[tauri::command]` deserialises JS args as camelCase by
 * default, so Rust `folder_path` → JS must send `folderPath`.
 */

// Detect if we're running inside Tauri
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    // Call Tauri's IPC directly — avoids dynamic import issues with bundlers
    return (window as any).__TAURI_INTERNALS__.invoke(command, args) as Promise<T>;
  }
  throw new Error(`Tauri not available. Command: ${command}`);
}

// ─── Study Management ─────────────────────────────────────────────────────────

export interface OrthancStudy {
  orthanc_id: string;
  study_instance_uid: string;
  patient_name: string;
  patient_id: string;
  study_description: string;
  study_date: string;
  modalities: string;
  series_count: number;
  instance_count: number;
  last_update: string;
}

export const getStudies = (): Promise<OrthancStudy[]> =>
  invoke<OrthancStudy[]>('get_studies');

export const checkStudyInOrthanc = (studyUid: string): Promise<boolean> =>
  invoke<boolean>('check_study_in_orthanc', { studyUid });

export const importStudyToOrthanc = (studyUid: string): Promise<{ success: boolean; instance_count: number }> =>
  invoke('import_study_to_orthanc', { studyUid });

export const deleteStudyFromOrthanc = (orthancId: string): Promise<void> =>
  invoke('delete_study_from_orthanc', { orthancId });

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface FileUpload {
  name: string;
  data: string; // base64
}

export interface SaveResult {
  filename: string;
  study_uid: string;
  success: boolean;
  error?: string;
}

export const uploadDicomFiles = (files: FileUpload[]): Promise<SaveResult[]> =>
  invoke('upload_dicom_files', { files });

export const uploadZip = (data: string, filename: string): Promise<SaveResult[]> =>
  invoke('upload_zip', { data, filename });

export const uploadFolder = (folderPath: string): Promise<SaveResult[]> =>
  invoke('upload_folder', { folderPath });

export const openFileDialog = (): Promise<string[] | null> =>
  invoke('open_file_dialog');

export const openFolderDialog = (): Promise<string | null> =>
  invoke('open_folder_dialog');

// ─── Authentication ──────────────────────────────────────────────────────────

export interface AuthResult {
  token: string;
  username: string;
  device_id: string;
}

export interface SessionInfo {
  valid: boolean;
  username: string;
}

const AUTH_TOKEN_KEY = 'ukubona_auth_token';
const AUTH_USER_KEY = 'ukubona_auth_user';
const AUTH_DEVICE_KEY = 'ukubona_device_id';

export const authenticate = (username: string, password: string): Promise<AuthResult> =>
  invoke('authenticate', { username, password });

export const validateSession = (token: string): Promise<SessionInfo> =>
  invoke('validate_session', { token });

export const logoutSession = (token: string): Promise<void> =>
  invoke('logout_session', { token });

export const getDeviceId = (): Promise<string> =>
  invoke('get_device_id');

/** Store the auth result in localStorage after a successful login. */
export function storeAuthToken(result: AuthResult): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, result.token);
    localStorage.setItem(AUTH_USER_KEY, result.username);
    localStorage.setItem(AUTH_DEVICE_KEY, result.device_id);
  } catch {
    // storage not available
  }
}

/** Get the current session token (empty string if not logged in). */
export function getAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/** Get the stored username. */
export function getStoredUsername(): string {
  try {
    return localStorage.getItem(AUTH_USER_KEY) || '';
  } catch {
    return '';
  }
}

/** Get the stored device ID. */
export function getStoredDeviceId(): string {
  try {
    return localStorage.getItem(AUTH_DEVICE_KEY) || '';
  } catch {
    return '';
  }
}

/** Clear all auth tokens from localStorage. */
export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_DEVICE_KEY);
  } catch {
    // storage not available
  }
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface Report {
  study_uid: string;
  patient_name?: string;
  findings: string;
  impression: string;
  radiologist?: string;
  created_at: string;
  updated_at: string;
}

export const saveReport = (studyUid: string, report: Report): Promise<void> =>
  invoke('save_report', { token: getAuthToken(), studyUid, report });

export const loadReport = (studyUid: string): Promise<Report | null> =>
  invoke('load_report', { token: getAuthToken(), studyUid });

export const listReports = (): Promise<string[]> =>
  invoke('list_reports', { token: getAuthToken() });

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  theme?: string;
  orthanc: { max_studies?: number; host?: string; port?: number };
  pacs?: { ae_title: string; host: string; port: number };
  ai: { api_endpoint?: string; api_key?: string; enabled_models?: string[] };
}

export const getSettings = (): Promise<AppSettings> =>
  invoke('get_settings');

export const saveSettings = (settings: AppSettings): Promise<void> =>
  invoke('save_settings', { settings });

// ─── System ───────────────────────────────────────────────────────────────────

export interface OrthancStatus {
  running: boolean;
  url: string;
  dicomweb_root: string;
}

export const getOrthancStatus = (): Promise<OrthancStatus> =>
  invoke('get_orthanc_status');

export const runCleanup = (maxStudies?: number): Promise<void> =>
  invoke('run_cleanup', { maxStudies });

export interface StorageStats {
  total_bytes: number;
  study_count: number;
  studies_dir: string;
}

export const getStorageStats = (): Promise<StorageStats> =>
  invoke('get_storage_stats');

// ─── PACS ─────────────────────────────────────────────────────────────────────

export interface PacsConfig {
  ae_title: string;
  host: string;
  port: number;
}

export interface PacsQuery {
  patient_name?: string;
  description?: string;
  date_range?: string;
  modality?: string;
}

export interface PacsStudy {
  patient_name: string;
  study_instance_uid: string;
  study_description: string;
  study_date: string;
  modality: string;
}

export const queryPacs = (config: PacsConfig, query: PacsQuery): Promise<PacsStudy[]> =>
  invoke('query_pacs', { config, query });

export const retrieveFromPacs = (config: PacsConfig, studyUid: string): Promise<string> =>
  invoke('retrieve_from_pacs', { config, studyUid });

// ─── Tauri Window helpers ────────────────────────────────────────────────────

/** Open a new Tauri webview window using __TAURI_INTERNALS__ directly. */
export async function openTauriWindow(
  label: string,
  opts: {
    url: string;
    title?: string;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    center?: boolean;
  },
): Promise<void> {
  if (!isTauri()) return;
  const inv = (window as any).__TAURI_INTERNALS__.invoke;
  // Try to focus existing window first
  try {
    await inv('plugin:window|set_focus', { label });
    return;
  } catch {
    // window doesn't exist, create it
  }
  try {
    await inv('plugin:webview|create_webview_window', {
      options: {
        label,
        url: opts.url,
        title: opts.title ?? 'Ukubona',
        width: opts.width ?? 800,
        height: opts.height ?? 600,
        minWidth: opts.minWidth,
        minHeight: opts.minHeight,
        center: opts.center ?? true,
        decorations: true,
        focus: true,
      },
    });
  } catch (e) {
    console.error('Failed to create Tauri window:', e);
  }
}

/** Close a Tauri window by label. Silently ignores if window doesn't exist. */
export async function closeTauriWindow(label: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close', { label });
  } catch {
    // window doesn't exist or already closed
  }
}

/** Get all window labels. */
export async function getAllWindowLabels(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const windows = await (window as any).__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows');
    return (windows ?? []).map((w: any) => w.label ?? w);
  } catch {
    return [];
  }
}

/** Close all popup windows (report_, ai_, settings_) */
export async function closeAllPopupWindows(): Promise<void> {
  const labels = await getAllWindowLabels();
  for (const label of labels) {
    if (label.startsWith('report_') || label.startsWith('ai_') || label.startsWith('settings_')) {
      await closeTauriWindow(label);
    }
  }
}

/** Check if any popup windows are open */
export async function hasOpenPopupWindows(): Promise<boolean> {
  const labels = await getAllWindowLabels();
  return labels.some(l => l.startsWith('report_') || l.startsWith('ai_') || l.startsWith('settings_'));
}

// ─── Orthanc URL helpers ──────────────────────────────────────────────────────

const ORTHANC_URL_KEY = 'ukubona_orthanc_url';
const ORTHANC_DEFAULT = 'http://127.0.0.1:8042';

/** Returns the current Orthanc base URL (from localStorage, with default fallback). */
export function getOrthancUrl(): string {
  try {
    return localStorage.getItem(ORTHANC_URL_KEY) || ORTHANC_DEFAULT;
  } catch {
    return ORTHANC_DEFAULT;
  }
}

/** In dev mode use proxy to avoid CORS; in production Tauri use direct Orthanc URL. */
export function getOrthancBase(): string {
  return window.location.protocol === 'http:'
    ? window.location.origin
    : getOrthancUrl();
}

/** Persist a new Orthanc URL to localStorage (takes effect after page reload). */
export function setOrthancUrl(host: string, port: number): void {
  const url = `http://${host}:${port}`;
  try {
    localStorage.setItem(ORTHANC_URL_KEY, url);
  } catch {
    // storage not available
  }
}

/** Fetch the live Orthanc URL from the Tauri backend (stays in sync with Rust). */
export const fetchOrthancUrl = (): Promise<string> =>
  invoke<string>('get_orthanc_url').catch(() => getOrthancUrl());

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a File object to base64 string */
export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (data:...;base64,)
      const base64 = result.split(',')[1] ?? result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/** Delete a study from Orthanc via HTTP (fallback when Tauri isn't available). */
export async function deleteStudyHttp(orthancId: string): Promise<void> {
  const resp = await fetch(`${getOrthancBase()}/studies/${orthancId}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
}
