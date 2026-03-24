import React, { useCallback, useRef, useState } from 'react';
import * as tauri from '../tauriBridge';

interface UploadZoneProps {
  onUploadComplete?: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

interface UploadJob {
  id: string;
  name: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  studyCount?: number;
}

export default function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const addJob = (name: string): string => {
    const id = Math.random().toString(36).slice(2);
    setJobs(prev => [...prev, { id, name, status: 'uploading', progress: 0 }]);
    return id;
  };

  const updateJob = (id: string, patch: Partial<UploadJob>) => {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));
  };

  const handleFiles = useCallback(
    async (files: File[]) => {
      const dicomFiles = files.filter(
        f => f.name.toLowerCase().endsWith('.dcm') || !f.name.includes('.')
      );
      if (dicomFiles.length === 0) return;

      const jobId = addJob(`${dicomFiles.length} DICOM file(s)`);
      setExpanded(true);

      try {
        // Convert files to base64 and upload via Tauri
        const uploads: tauri.FileUpload[] = await Promise.all(
          dicomFiles.map(async f => ({
            name: f.name,
            data: await tauri.fileToBase64(f),
          }))
        );

        updateJob(jobId, { progress: 50 });
        const results = await tauri.uploadDicomFiles(uploads);
        const succeeded = results.filter(r => r.success).length;

        updateJob(jobId, {
          status: 'success',
          progress: 100,
          studyCount: succeeded,
        });
        onUploadComplete?.();
      } catch (e) {
        updateJob(jobId, { status: 'error', error: String(e) });
      }
    },
    [onUploadComplete]
  );

  const handleZipFile = useCallback(
    async (file: File) => {
      const jobId = addJob(file.name);
      setExpanded(true);

      try {
        const b64 = await tauri.fileToBase64(file);
        updateJob(jobId, { progress: 30 });
        const results = await tauri.uploadZip(b64, file.name);
        const succeeded = results.filter(r => r.success).length;

        updateJob(jobId, { status: 'success', progress: 100, studyCount: succeeded });
        onUploadComplete?.();
      } catch (e) {
        updateJob(jobId, { status: 'error', error: String(e) });
      }
    },
    [onUploadComplete]
  );

  const handleFolderPick = useCallback(async () => {
    try {
      const folderPath = await tauri.openFolderDialog();
      if (!folderPath) return;

      const jobId = addJob(`Folder: ${folderPath.split('/').pop()}`);
      setExpanded(true);
      updateJob(jobId, { progress: 20 });

      const results = await tauri.uploadFolder(folderPath);
      const succeeded = results.filter(r => r.success).length;

      updateJob(jobId, { status: 'success', progress: 100, studyCount: succeeded });
      onUploadComplete?.();
    } catch (e) {
      console.error('Folder upload error:', e);
    }
  }, [onUploadComplete]);

  const handleFilePick = useCallback(async () => {
    try {
      const paths = await tauri.openFileDialog();
      if (!paths || paths.length === 0) return;
      // Trigger browser fallback via hidden input if in browser mode
      fileInputRef.current?.click();
    } catch {
      fileInputRef.current?.click();
    }
  }, []);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const zips = files.filter(f => f.name.toLowerCase().endsWith('.zip'));
    const dicoms = files.filter(f => !f.name.toLowerCase().endsWith('.zip'));

    zips.forEach(handleZipFile);
    if (dicoms.length > 0) handleFiles(dicoms);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    handleFiles(files);
    e.target.value = '';
  };

  const onZipInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(handleZipFile);
    e.target.value = '';
  };

  return (
    <div className="w-full">
      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-6 px-4 text-center transition-all',
          dragging
            ? 'border-[#63b3ed] bg-[#63b3ed]/5'
            : 'border-white/10 bg-[#111827] hover:border-white/20',
        ].join(' ')}
      >
        {/* Upload icon */}
        <svg
          className="mb-2 text-[#4a5568]"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>

        <p className="mb-1 text-sm font-medium text-[#a0aec0]">
          {dragging ? 'Drop files here' : 'Drag & drop DICOM files or ZIP archives'}
        </p>

        <p className="mb-4 text-xs text-[#4a5568]">or use the buttons below</p>

        {/* Action buttons */}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={handleFilePick}
            className="rounded-lg bg-[#1a2035] px-4 py-2 text-xs font-medium text-[#a0aec0] ring-1 ring-white/10 transition hover:bg-[#2d3748] hover:text-white"
          >
            Upload DICOM Files
          </button>

          <button
            onClick={() => zipInputRef.current?.click()}
            className="rounded-lg bg-[#1a2035] px-4 py-2 text-xs font-medium text-[#a0aec0] ring-1 ring-white/10 transition hover:bg-[#2d3748] hover:text-white"
          >
            Upload ZIP
          </button>

          <button
            onClick={handleFolderPick}
            className="rounded-lg bg-[#1a2035] px-4 py-2 text-xs font-medium text-[#a0aec0] ring-1 ring-white/10 transition hover:bg-[#2d3748] hover:text-white"
          >
            Upload Folder
          </button>
        </div>

        {/* Hidden inputs (browser fallback) */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".dcm"
          multiple
          onChange={onFileInputChange}
          className="hidden"
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          onChange={onZipInputChange}
          className="hidden"
        />
      </div>

      {/* Upload job status list */}
      {jobs.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs text-[#718096] hover:text-white"
          >
            <span>{jobs.length} upload{jobs.length !== 1 ? 's' : ''}</span>
            <span>{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded && (
            <div className="divide-y divide-white/5">
              {jobs.map(job => (
                <div key={job.id} className="flex items-center gap-3 px-4 py-2">
                  {/* Status icon */}
                  {job.status === 'uploading' && (
                    <div className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-[#63b3ed] border-t-transparent" />
                  )}
                  {job.status === 'success' && (
                    <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-green-500 text-center text-[8px] text-white leading-none flex items-center justify-center">✓</div>
                  )}
                  {job.status === 'error' && (
                    <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-red-500 text-center text-[8px] text-white leading-none flex items-center justify-center">✕</div>
                  )}

                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs text-[#a0aec0]">{job.name}</span>

                    {job.status === 'uploading' && (
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#1a2035]">
                        <div
                          className="h-full rounded-full bg-[#63b3ed] transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}
                    {job.status === 'success' && job.studyCount !== undefined && (
                      <span className="text-[11px] text-[#48bb78]">
                        {job.studyCount} file{job.studyCount !== 1 ? 's' : ''} imported
                      </span>
                    )}
                    {job.status === 'error' && (
                      <span className="text-[11px] text-red-400">{job.error}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
