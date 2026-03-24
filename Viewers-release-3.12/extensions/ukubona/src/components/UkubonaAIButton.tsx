import React, { useState } from 'react';
import UkubonaAIModal from './UkubonaAIModal';

interface UkubonaAIButtonProps {
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  apiEndpoint?: string;
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
    </svg>
  );
}

export default function UkubonaAIButton({
  studyInstanceUID,
  seriesInstanceUID,
  apiEndpoint,
}: UkubonaAIButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Run AI Analysis"
        className={[
          'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold',
          'bg-gradient-to-r from-[#805ad5] to-[#63b3ed]',
          'text-white shadow-md shadow-[#805ad5]/20',
          'transition-all hover:opacity-90 hover:shadow-[#805ad5]/40',
          'focus:outline-none focus:ring-2 focus:ring-[#63b3ed]/40',
        ].join(' ')}
      >
        <SparkleIcon />
        <span>AI Analysis</span>
      </button>

      {open && (
        <UkubonaAIModal
          studyInstanceUID={studyInstanceUID}
          seriesInstanceUID={seriesInstanceUID}
          onClose={() => setOpen(false)}
          apiEndpoint={apiEndpoint}
        />
      )}
    </>
  );
}
