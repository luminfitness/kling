'use client';

import { useBatchSubmission } from '@/contexts/BatchSubmissionContext';

/**
 * Bottom-right floating panel showing batch processing progress.
 * Similar to Google Drive's upload progress indicator.
 *
 * Persists across page navigation since it's rendered in NavBar (global).
 *
 * Progress states:
 * - Gray circle: pending (queued, waiting for slot, downloading, trimming)
 * - Blue spinner: processing (actively on Kling)
 * - Green checkmark: completed (Kling finished and video saved)
 * - Red exclamation: failed
 *
 * Panel stays visible until user dismisses or all items complete.
 */
export default function BatchProgressPanel() {
  const { items, isSubmitting, processingProgress, dismissItem } = useBatchSubmission();

  // Count by status
  const completed = items.filter(i => i.status === 'completed').length;
  const failed = items.filter(i => i.status === 'failed').length;
  const pending = items.filter(i => i.status === 'pending').length;
  const processing = items.filter(i => i.status === 'processing').length;
  const total = items.length;
  const inProgress = pending + processing; // Items still being processed

  // Dismiss all items (close the panel)
  const handleDismissAll = () => {
    items.forEach(item => dismissItem(item.template.id));
  };

  // Don't show if not processing and no items
  if (!isSubmitting && items.length === 0) {
    return null;
  }

  // Build list of all items to display
  const displayItems = items.map(item => ({
    id: item.template.id,
    name: item.template.exerciseName,
    status: item.status,
  }));

  // Build header text
  const getHeaderText = () => {
    if (isSubmitting || inProgress > 0) {
      if (processing > 0 && pending === 0) {
        return `Waiting for Kling... (${processing})`;
      }
      return `Processing ${total} item${total !== 1 ? 's' : ''}`;
    }
    // All done - show results
    if (failed > 0 && completed === 0) {
      return `${failed} failed`;
    }
    if (failed > 0 && completed > 0) {
      return `${completed} complete, ${failed} failed`;
    }
    return `${completed} complete`;
  };

  // Progress indicator component
  const ProgressIndicator = ({ status }: {
    status: 'pending' | 'processing' | 'completed' | 'failed';
  }) => {
    // Completed - green checkmark
    if (status === 'completed') {
      return (
        <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    }

    // Failed - red exclamation
    if (status === 'failed') {
      return (
        <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
      );
    }

    // Processing on Kling - blue spinner
    if (status === 'processing') {
      return (
        <div className="w-5 h-5 flex-shrink-0">
          <svg className="animate-spin w-5 h-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      );
    }

    // Pending - gray circle (up next / waiting)
    return (
      <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" title="Up next" />
    );
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-900 text-sm">
            {getHeaderText()}
          </span>
          {/* Close button - only show when all processing is done */}
          {!isSubmitting && inProgress === 0 && (
            <button
              onClick={handleDismissAll}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {inProgress > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">
            {inProgress} remaining
          </p>
        )}
      </div>

      {/* Items list */}
      <div className="max-h-64 overflow-y-auto">
        {displayItems.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0 ${
              item.status === 'completed' ? 'bg-green-50 text-green-900' :
              item.status === 'failed' ? 'bg-red-50 text-red-900' :
              'bg-white text-gray-900'
            }`}
          >
            <ProgressIndicator status={item.status} />
            <div className="flex-1 min-w-0">
              <span className="text-sm truncate block">{item.name}</span>
              <span className="text-xs text-gray-500 truncate block">
                {item.status === 'pending' && 'Up next'}
                {item.status === 'processing' && 'Processing on Kling...'}
                {item.status === 'completed' && 'Complete'}
                {item.status === 'failed' && 'Failed'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Summary footer - only show when all done */}
      {(completed > 0 || failed > 0) && !isSubmitting && inProgress === 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center gap-4 text-xs">
            {completed > 0 && (
              <span className="text-green-600">✓ {completed} complete</span>
            )}
            {failed > 0 && (
              <span className="text-red-600">✗ {failed} failed</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
