'use client';

import { useEffect } from 'react';

interface BatchProcessingModalProps {
  currentIndex: number;
  total: number;
  currentName: string;
  errorCount: number;
  elapsedMs: number;
}

export default function BatchProcessingModal({
  currentIndex,
  total,
  currentName,
  errorCount,
  elapsedMs,
}: BatchProcessingModalProps) {
  // Warn before closing tab
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const pct = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
  const avgMs = currentIndex > 0 ? elapsedMs / currentIndex : 0;
  const remaining = Math.max(0, total - currentIndex);
  const etaSec = Math.round((remaining * avgMs) / 1000);
  const etaMin = Math.floor(etaSec / 60);
  const etaSecRem = etaSec % 60;
  const etaLabel = currentIndex > 0
    ? etaMin > 0
      ? `~${etaMin}m ${etaSecRem}s remaining`
      : `~${etaSec}s remaining`
    : 'Estimating...';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Processing Videos</h2>
        <p className="text-sm text-gray-500">Keep this tab open — processing videos in-browser.</p>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{currentIndex} / {total}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Current exercise */}
        <div className="text-sm text-gray-700">
          <span className="text-gray-400">Current:</span>{' '}
          <span className="font-medium">{currentName}</span>
        </div>

        {/* ETA */}
        <p className="text-xs text-gray-400">{etaLabel}</p>

        {/* Error count */}
        {errorCount > 0 && (
          <p className="text-xs text-red-500">{errorCount} error{errorCount > 1 ? 's' : ''}</p>
        )}
      </div>
    </div>
  );
}
