'use client';

import type { LoopExerciseSummary } from '@/types';

interface LoopResultsTableProps {
  exercises: LoopExerciseSummary[];
  loading: boolean;
  onReview: (exerciseName: string) => void;
  onBatchReview: () => void;
  onDownload: (exercise: LoopExerciseSummary) => void;
}

export default function LoopResultsTable({
  exercises,
  loading,
  onReview,
  onBatchReview,
  onDownload,
}: LoopResultsTableProps) {
  const unreviewedCount = exercises.filter((e) => !e.reviewed && !e.flagged).length;
  const flaggedCount = exercises.filter((e) => e.flagged).length;
  const needsReview = unreviewedCount + flaggedCount;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
        <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading results...
      </div>
    );
  }

  if (exercises.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        No processed results yet. Upload videos to get started.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Batch review button */}
      {needsReview > 0 && (
        <button
          onClick={onBatchReview}
          className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
        >
          Batch Review ({needsReview} to review)
        </button>
      )}

      {/* Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">Exercise</th>
              <th className="text-center px-3 py-2.5 font-medium text-gray-600 w-20">Variants</th>
              <th className="text-center px-3 py-2.5 font-medium text-gray-600 w-28">Status</th>
              <th className="text-center px-3 py-2.5 font-medium text-gray-600 w-24">Keeper</th>
              <th className="text-center px-3 py-2.5 font-medium text-gray-600 w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {exercises.map((ex) => (
              <tr
                key={ex.exerciseName}
                className={`hover:bg-gray-50 transition-colors ${!ex.reviewed && !ex.flagged ? 'opacity-60' : ''}`}
              >
                {/* Exercise Name */}
                <td className="px-4 py-2.5 font-medium text-gray-900">
                  {ex.exerciseName.replace(/\.[^.]+$/, '')}
                </td>

                {/* Variants */}
                <td className="text-center px-3 py-2.5 text-gray-600">
                  {ex.variantCount}
                </td>

                {/* Status */}
                <td className="text-center px-3 py-2.5">
                  {ex.flagged ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
                      </svg>
                      Flagged
                    </span>
                  ) : ex.reviewed ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Reviewed
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Pending</span>
                  )}
                </td>

                {/* Keeper */}
                <td className="text-center px-3 py-2.5">
                  {ex.hasKeeper ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                      <svg className="h-3.5 w-3.5 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      {ex.keeperLabel}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">&mdash;</span>
                  )}
                </td>

                {/* Actions */}
                <td className="text-center px-3 py-2.5">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      onClick={() => onReview(ex.exerciseName)}
                      className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      Review
                    </button>
                    <button
                      onClick={() => onDownload(ex)}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title="Download"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <p className="text-xs text-gray-400">
        {exercises.length} exercise{exercises.length !== 1 ? 's' : ''} &middot;{' '}
        {exercises.filter((e) => e.reviewed).length} reviewed &middot;{' '}
        {exercises.filter((e) => e.hasKeeper).length} with keepers
      </p>
    </div>
  );
}
