import React, { useState } from 'react';
import * as tauri from '../tauriBridge';

interface PacsConnectorProps {
  onStudyRetrieved?: () => void;
}

export default function PacsConnector({ onStudyRetrieved }: PacsConnectorProps) {
  const [config, setConfig] = useState<tauri.PacsConfig>({
    ae_title: '',
    host: '',
    port: 104,
  });

  const [query, setQuery] = useState<tauri.PacsQuery>({
    patient_name: '',
    description: '',
    date_range: '',
    modality: '',
  });

  const [results, setResults] = useState<tauri.PacsStudy[]>([]);
  const [querying, setQuerying] = useState(false);
  const [retrieving, setRetrieving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleQuery = async () => {
    if (!config.ae_title || !config.host) {
      setError('AE Title and Host are required');
      return;
    }

    setQuerying(true);
    setError(null);
    setResults([]);

    try {
      const studies = await tauri.queryPacs(config, query);
      setResults(studies);
      if (studies.length === 0) setMessage('No studies found matching your query.');
      else setMessage(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setQuerying(false);
    }
  };

  const handleRetrieve = async (study: tauri.PacsStudy) => {
    setRetrieving(study.study_instance_uid);
    setError(null);
    try {
      const msg = await tauri.retrieveFromPacs(config, study.study_instance_uid);
      setMessage(msg);
      onStudyRetrieved?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setRetrieving(null);
    }
  };

  const inputClass =
    'rounded-lg border border-white/10 bg-[#1a2035] px-3 py-2 text-sm text-white placeholder-[#4a5568] outline-none focus:border-[#63b3ed]/50 focus:ring-1 focus:ring-[#63b3ed]/30';

  return (
    <div className="flex flex-col gap-6">
      {/* PACS Connection */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#718096]">
          PACS Connection
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#a0aec0]">AE Title</span>
            <input
              className={inputClass}
              value={config.ae_title}
              onChange={e => setConfig(c => ({ ...c, ae_title: e.target.value }))}
              placeholder="REMOTE_PACS"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#a0aec0]">Host</span>
            <input
              className={inputClass}
              value={config.host}
              onChange={e => setConfig(c => ({ ...c, host: e.target.value }))}
              placeholder="192.168.1.100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#a0aec0]">Port</span>
            <input
              type="number"
              className={inputClass}
              value={config.port}
              onChange={e => setConfig(c => ({ ...c, port: Number(e.target.value) }))}
              placeholder="104"
            />
          </label>
        </div>
      </div>

      {/* Query */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#718096]">
          Search Query
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#a0aec0]">Patient Name</span>
            <input
              className={inputClass}
              value={query.patient_name}
              onChange={e => setQuery(q => ({ ...q, patient_name: e.target.value }))}
              placeholder="Smith*"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#a0aec0]">Study Description</span>
            <input
              className={inputClass}
              value={query.description}
              onChange={e => setQuery(q => ({ ...q, description: e.target.value }))}
              placeholder="Chest*"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#a0aec0]">Date Range (YYYYMMDD-YYYYMMDD)</span>
            <input
              className={inputClass}
              value={query.date_range}
              onChange={e => setQuery(q => ({ ...q, date_range: e.target.value }))}
              placeholder="20240101-20241231"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#a0aec0]">Modality</span>
            <input
              className={inputClass}
              value={query.modality}
              onChange={e => setQuery(q => ({ ...q, modality: e.target.value }))}
              placeholder="CT"
            />
          </label>
        </div>
        <button
          onClick={handleQuery}
          disabled={querying}
          className="mt-3 rounded-lg bg-[#63b3ed] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#4299e1] disabled:opacity-50"
        >
          {querying ? 'Searching...' : 'Search PACS'}
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-lg bg-red-900/30 p-3 text-sm text-red-400 ring-1 ring-red-500/30">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg bg-green-900/20 p-3 text-sm text-green-400 ring-1 ring-green-500/20">
          {message}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#718096]">
            Results ({results.length})
          </p>
          <div className="flex flex-col gap-2">
            {results.map(study => (
              <div
                key={study.study_instance_uid}
                className="flex items-center justify-between rounded-xl bg-[#1a2035] p-3 ring-1 ring-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{study.patient_name}</p>
                  <p className="truncate text-xs text-[#718096]">
                    {study.study_description || '—'} · {study.modality} · {study.study_date}
                  </p>
                </div>
                <button
                  onClick={() => handleRetrieve(study)}
                  disabled={retrieving === study.study_instance_uid}
                  className="ml-3 flex-shrink-0 rounded-lg bg-[#2d3748] px-3 py-1.5 text-xs text-[#a0aec0] transition hover:bg-[#4a5568] hover:text-white disabled:opacity-50"
                >
                  {retrieving === study.study_instance_uid ? 'Retrieving...' : 'Retrieve'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
