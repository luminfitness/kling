'use client';

interface ActiveItem {
  name: string;
  stage: string;
}

interface ProcessingModalProps {
  isOpen: boolean;
  onClose: () => void;
  total: number;
  completed: number;
  failed: number;
  activeItems: ActiveItem[];  // Now supports multiple concurrent items
  isDone: boolean;
  onCancel: () => void;
}

export default function ProcessingModal({
  isOpen,
  onClose,
  total,
  completed,
  failed,
  activeItems,
  isDone,
  onCancel,
}: ProcessingModalProps) {
  if (!isOpen) return null;

  const processed = completed + failed;
  const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const remaining = total - processed - activeItems.length; // Subtract active items from remaining

  const getStageLabel = (stage: string): string => {
    switch (stage) {
      case 'downloading':
        return 'Downloading video...';
      case 'trimming':
        return 'Trimming video...';
      case 'submitting':
        return 'Submitting to Kling...';
      case 'polling':
        return 'Processing on Kling...';
      case 'waiting':
        return 'Waiting for slot...';
      default:
        return 'Processing...';
    }
  };

  const handleClose = () => {
    if (isDone) {
      onClose();
      window.location.reload();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {isDone ? 'Processing Complete!' : 'Processing Exercises'}
          </h2>
          {isDone && (
            <button
              onClick={handleClose}
              className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-5">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">
                {processed} of {total}
              </span>
              <span className="text-gray-500">{progressPercent}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Active items - show all concurrent processing */}
          {!isDone && activeItems.length > 0 && (
            <div className="space-y-2">
              {activeItems.map((item) => (
                <div key={item.name} className="rounded-lg bg-gray-50 px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    <span className="text-sm font-medium text-gray-700 truncate">
                      {item.name}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 pl-6">
                    {getStageLabel(item.stage)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Status counts */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-gray-700">{completed} completed</span>
            </div>
            {failed > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100">
                  <span className="text-xs font-bold text-red-600">!</span>
                </div>
                <span className="text-gray-700">{failed} failed</span>
              </div>
            )}
            {!isDone && remaining > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100">
                  <span className="text-xs font-medium text-gray-500">{remaining}</span>
                </div>
                <span className="text-gray-500">remaining</span>
              </div>
            )}
          </div>

          {/* Done message */}
          {isDone && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
              <p className="text-sm text-blue-800">
                {failed > 0 ? (
                  <>
                    Completed exercises have been saved to your library.
                    Failed items have been returned to the pending table with error details.
                  </>
                ) : (
                  <>
                    All exercises have been saved to your library.
                    Click &quot;Close &amp; Refresh&quot; to see them in the Completed section.
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end gap-3">
          {isDone ? (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Close &amp; Refresh
            </button>
          ) : (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel Remaining
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
