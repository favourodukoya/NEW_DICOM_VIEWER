import React, { useState } from 'react';
import {
  isTauri,
  authenticate as tauriAuthenticate,
  logoutSession,
  storeAuthToken,
  getAuthToken,
  getStoredUsername,
  clearAuthToken,
} from '../tauriBridge';

// Legacy fallback key for browser dev mode only
const SESSION_KEY = 'ukubona_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Quick synchronous check: is the user logged in? */
export function isAuthenticated(): boolean {
  if (isTauri()) {
    return !!getAuthToken();
  }
  // Browser dev-mode fallback
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    return s?.user && Date.now() - s.ts < SESSION_TTL_MS;
  } catch {
    return false;
  }
}

/** Get the current session username. */
export function getSessionUser(): string {
  if (isTauri()) {
    return getStoredUsername();
  }
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw)?.user ?? '' : '';
  } catch {
    return '';
  }
}

/** Store session info (called after successful login). */
export function setSession(user: string) {
  // Browser dev-mode fallback
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, ts: Date.now() }));
}

/** Clear session and call backend logout. */
export function clearSession() {
  if (isTauri()) {
    const token = getAuthToken();
    if (token) logoutSession(token).catch(() => {});
    clearAuthToken();
  }
  localStorage.removeItem(SESSION_KEY);
}

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isTauri()) {
        // Authenticate through the secure Rust backend
        const result = await tauriAuthenticate(username, password);
        storeAuthToken(result);
        setSession(result.username);
        onLogin();
      } else {
        // Browser dev-mode fallback (no Tauri backend)
        await new Promise(r => setTimeout(r, 400));
        if (username === 'admin' && password === 'admin') {
          setSession(username);
          onLogin();
        } else {
          setError('Invalid username or password');
          setLoading(false);
        }
      }
    } catch (err: any) {
      setError(err?.message || err?.toString() || 'Authentication failed');
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080b12]">
      {/* Animated background gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#3b82f6]/8 blur-[120px] animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute -right-32 top-1/3 h-80 w-80 rounded-full bg-[#8b5cf6]/6 blur-[100px] animate-pulse" style={{ animationDuration: '8s', animationDelay: '2s' }} />
        <div className="absolute -bottom-20 left-1/3 h-72 w-72 rounded-full bg-[#06b6d4]/5 blur-[100px] animate-pulse" style={{ animationDuration: '7s', animationDelay: '4s' }} />
      </div>

      {/* Subtle grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative z-10 w-full max-w-[400px] px-6">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <img
            src="/ukubona-logo.png"
            alt="Ukubona"
            className="h-24 object-contain drop-shadow-lg"
            style={{ filter: 'drop-shadow(0 4px 20px rgba(59, 130, 246, 0.15))' }}
          />
          <p className="mt-2 text-xs tracking-widest text-[#4b5563] uppercase">DICOM Workstation</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border border-white/[0.06] bg-[#0f1219]/80 p-7 shadow-2xl backdrop-blur-xl"
          style={{
            boxShadow: '0 0 80px rgba(59, 130, 246, 0.04), 0 25px 50px rgba(0,0,0,0.5)',
          }}
        >
          <h2 className="mb-1 text-lg font-semibold text-white">Welcome back</h2>
          <p className="mb-6 text-sm text-[#6b7280]">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Username */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#9ca3af]">Username</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4b5563]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                  className="w-full rounded-xl border border-white/[0.06] bg-[#0a0d14] py-2.5 pl-10 pr-3 text-sm text-white placeholder-[#374151] outline-none transition-all duration-200 focus:border-[#3b82f6]/50 focus:ring-2 focus:ring-[#3b82f6]/20 focus:bg-[#0c1018]"
                  placeholder="Enter username"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#9ca3af]">Password</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4b5563]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full rounded-xl border border-white/[0.06] bg-[#0a0d14] py-2.5 pl-10 pr-10 text-sm text-white placeholder-[#374151] outline-none transition-all duration-200 focus:border-[#3b82f6]/50 focus:ring-2 focus:ring-[#3b82f6]/20 focus:bg-[#0c1018]"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4b5563] hover:text-[#9ca3af] transition"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Forgot password */}
            <div className="flex justify-end">
              <a
                href="https://viewer.ukubona.cloud/dicom-viewer/forgot-password"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#3b82f6]/70 transition hover:text-[#3b82f6]"
              >
                Forgot password?
              </a>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/20">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="group relative mt-1 w-full overflow-hidden rounded-xl bg-gradient-to-r from-[#3b82f6] to-[#2563eb] py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#3b82f6]/20 transition-all duration-200 hover:shadow-[#3b82f6]/30 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </span>
            </button>
          </form>
        </div>

        {/* Register link */}
        <p className="mt-6 text-center text-sm text-[#6b7280]">
          Don't have an account?{' '}
          <a
            href="https://viewer.ukubona.cloud/dicom-viewer/register"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#3b82f6] transition hover:text-[#60a5fa]"
          >
            Register
          </a>
        </p>

        {/* Footer */}
        <p className="mt-8 text-center text-[10px] text-[#374151]">
          Ukubona DICOM Workstation
        </p>
      </div>
    </div>
  );
}
