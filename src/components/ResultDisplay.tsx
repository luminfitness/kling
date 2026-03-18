'use client';

import { useState } from 'react';
import type { PendingTaskMeta } from '@/types';

const COST_PER_SEC: Record<string, number> = {
  std: 0.07,
  pro: 0.112,
};

interface ResultDisplayProps {
  videoUrl: string;
  taskMeta?: PendingTaskMeta | null;
  videoDurationSec?: number;
}

export default function ResultDisplay({
  videoUrl,
  taskMeta,
  videoDurationSec,
}: ResultDisplayProps) {
  const [downloading, setDownloading] = useState(false);

  // Calculate cost
  const mode = taskMeta?.mode || 'std';
  const costUsd =
    videoDurationSec && !isNaN(videoDurationSec)
      ? videoDurationSec * COST_PER_SEC[mode]
      : 0;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(videoUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transformed-video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(videoUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-center py-8">
      <div className="mb-4 w-full max-w-2xl overflow-hidden rounded-xl border bg-black shadow-lg">
        <video src={videoUrl} controls autoPlay className="w-full" />
      </div>

      {/* Cost info */}
      {costUsd > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2">
          <span className="text-sm text-gray-500">
            {videoDurationSec?.toFixed(0)}s · {mode === 'pro' ? 'Pro' : 'Standard'} ·
          </span>
          <span className="text-sm font-semibold text-gray-900">
            ${costUsd.toFixed(2)}
          </span>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {downloading ? 'Downloading...' : 'Download Video'}
        </button>
        <a
          href="/"
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Create Another
        </a>
      </div>

      {/* Auto-saved note */}
      <div className="mt-6 text-center">
        <p className="mb-1 text-sm text-green-600 font-medium">
          Auto-saved to library
        </p>
        <a
          href="/library"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          View Library
        </a>
      </div>
    </div>
  );
}
