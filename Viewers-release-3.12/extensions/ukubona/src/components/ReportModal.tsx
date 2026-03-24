import React, { useState, useEffect } from 'react';
import * as tauri from '../tauriBridge';

interface ReportModalProps {
  studyInstanceUID: string;
  patientName?: string;
  onClose: () => void;
}

export default function ReportModal({
  studyInstanceUID,
  patientName,
  onClose,
}: ReportModalProps) {
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [radiologist, setRadiologist] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load existing report on mount
  useEffect(() => {
    tauri
      .loadReport(studyInstanceUID)
      .then(existing => {
        if (existing) {
          setFindings(existing.findings);
          setImpression(existing.impression);
          setRadiologist(existing.radiologist ?? '');
        }
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [studyInstanceUID]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const now = new Date().toISOString();
      await tauri.saveReport(studyInstanceUID, {
        study_uid: studyInstanceUID,
        patient_name: patientName,
        findings,
        impression,
        radiologist: radiologist || undefined,
        created_at: now,
        updated_at: now,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-[#111827] shadow-2xl ring-1 ring-white/10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Radiology Report</h2>
            {patientName && (
              <p className="text-xs text-[#718096]">{patientName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="rounded-lg bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400 ring-1 ring-green-500/30">
                Saved ✓
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#718096] hover:bg-white/5 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#63b3ed] border-t-transparent" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            {/* Radiologist */}
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#718096]">
                Radiologist
              </label>
              <input
                type="text"
                value={radiologist}
                onChange={e => setRadiologist(e.target.value)}
                placeholder="Dr. Name"
                className="w-full rounded-lg border border-white/10 bg-[#1a2035] px-3 py-2 text-sm text-white placeholder-[#4a5568] outline-none focus:border-[#63b3ed]/50 focus:ring-1 focus:ring-[#63b3ed]/30"
              />
            </div>

            {/* Study UID (read-only info) */}
            <div className="rounded-lg bg-[#1a2035] px-3 py-2 text-xs text-[#4a5568]">
              Study UID: {studyInstanceUID}
            </div>

            {/* Findings */}
            <div className="flex flex-1 flex-col">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#718096]">
                Findings
              </label>
              <textarea
                value={findings}
                onChange={e => setFindings(e.target.value)}
                placeholder="Describe the imaging findings in detail..."
                className="flex-1 resize-none rounded-lg border border-white/10 bg-[#1a2035] px-3 py-2 text-sm text-white placeholder-[#4a5568] outline-none focus:border-[#63b3ed]/50 focus:ring-1 focus:ring-[#63b3ed]/30"
                rows={6}
              />
            </div>

            {/* Impression */}
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#718096]">
                Impression
              </label>
              <textarea
                value={impression}
                onChange={e => setImpression(e.target.value)}
                placeholder="Summary and clinical interpretation..."
                className="w-full resize-none rounded-lg border border-white/10 bg-[#1a2035] px-3 py-2 text-sm text-white placeholder-[#4a5568] outline-none focus:border-[#63b3ed]/50 focus:ring-1 focus:ring-[#63b3ed]/30"
                rows={4}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-900/30 p-3 text-xs text-red-400 ring-1 ring-red-500/30">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 px-6 py-4">
          <p className="text-xs text-[#4a5568]">
            Saved locally to app data
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-[#718096] hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className={[
                'rounded-lg px-4 py-2 text-sm font-medium transition',
                saving || loading
                  ? 'bg-[#1a2035] text-[#4a5568] cursor-not-allowed'
                  : 'bg-[#63b3ed] text-white hover:bg-[#4299e1]',
              ].join(' ')}
            >
              {saving ? 'Saving...' : 'Save Report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
