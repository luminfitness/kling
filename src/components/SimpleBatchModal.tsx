'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  processSingleTemplate,
  saveResultsToLibrary,
  deleteProcessedTemplates,
  getHumanReadableError,
  type BatchResult,
  type ProcessingStep,
} from '@/lib/simpleBatch';
import type { ExerciseTemplate } from '@/types';

interface SimpleBatchModalProps {
  isOpen: boolean;
  templates: ExerciseTemplate[];
  onClose: () => void;
  onComplete: () => void;
}

interface ProcessingState {
  currentIndex: number;
  currentStep: ProcessingStep;
  stepDetail?: string;
  results: BatchResult[];
  isComplete: boolean;
  isSaving: boolean;
}

const STEP_LABELS: Record<ProcessingStep, string> = {
  downloading: 'Downloading video...',
  trimming: 'Trimming video...',
  uploading: 'Uploading video...',
  submitting: 'Submitting to Kling...',
  processing: 'Processing on Kling...',
  'downloading-output': 'Downloading output...',
  complete: 'Complete',
  failed: 'Failed',
};

export default function SimpleBatchModal({
  isOpen,
  templates,
  onClose,
  onComplete,
}: SimpleBatchModalProps) {
  const [state, setState] = useState<ProcessingState>({
    currentIndex: 0,
    currentStep: 'downloading',
    results: [],
    isComplete: false,
    isSaving: false,
  });

  const isProcessingRef = useRef(false);
  const abortRef = useRef(false);

  const processAll = useCallback(async () => {
    if (isProcessingRef.current || templates.length === 0) return;
    isProcessingRef.current = true;
    abortRef.current = false;

    const results: BatchResult[] = [];

    for (let i = 0; i < templates.length; i++) {
      if (abortRef.current) break;

      const template = templates[i];
      setState((prev) => ({
        ...prev,
        currentIndex: i,
        currentStep: 'downloading',
        stepDetail: undefined,
      }));

      const result = await processSingleTemplate(template, (step, detail) => {
        setState((prev) => ({
          ...prev,
          currentStep: step,
          stepDetail: detail,
        }));
      });

      results.push(result);
      setState((prev) => ({ ...prev, results: [...results] }));
    }

    // Processing complete
    setState((prev) => ({ ...prev, isComplete: true }));

    // Auto-save to library
    setState((prev) => ({ ...prev, isSaving: true }));
    try {
      await saveResultsToLibrary(results);
      await deleteProcessedTemplates(results);
    } catch (error) {
      console.error('Failed to save results:', error);
    }
    setState((prev) => ({ ...prev, isSaving: false }));

    isProcessingRef.current = false;
  }, [templates]);

  useEffect(() => {
    if (isOpen && templates.length > 0) {
      processAll();
    }
  }, [isOpen, templates, processAll]);

  if (!isOpen) return null;

  const completedCount = state.results.filter((r) => r.status === 'completed').length;
  const failedCount = state.results.filter((r) => r.status === 'failed').length;
  const remainingCount = templates.length - state.results.length;
  const currentTemplate = templates[state.currentIndex];

  const handleClose = () => {
    if (!state.isComplete) {
      const confirmed = window.confirm(
        'Processing is still in progress. Are you sure you want to close? Any unfinished items will be lost.'
      );
      if (!confirmed) return;
      abortRef.current = true;
    }
    onComplete();
    onClose();
  };

  // Step progress indicator
  const StepIndicator = ({ step, isActive }: { step: ProcessingStep; isActive: boolean }) => {
    const isCompleted =
      state.results.length > state.currentIndex ||
      (state.results.length === state.currentIndex &&
        ['complete', 'failed'].includes(state.currentStep));

    const stepOrder: ProcessingStep[] = [
      'downloading',
      'submitting',
      'processing',
      'downloading-output',
    ];
    const currentStepIndex = stepOrder.indexOf(state.currentStep);
    const thisStepIndex = stepOrder.indexOf(step);
    const isPast = thisStepIndex < currentStepIndex;

    return (
      <div className="flex items-center gap-3 py-2">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
            isActive
              ? 'bg-blue-500'
              : isPast || isCompleted
                ? 'bg-green-500'
                : 'bg-gray-200'
          }`}
        >
          {isActive ? (
            <svg
              className="animate-spin w-3 h-3 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : isPast || isCompleted ? (
            <svg
              className="w-3 h-3 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <div className="w-2 h-2 rounded-full bg-gray-400" />
          )}
        </div>
        <span
          className={`text-sm ${
            isActive ? 'text-blue-600 font-medium' : isPast ? 'text-green-600' : 'text-gray-500'
          }`}
        >
          {STEP_LABELS[step]}
          {isActive && state.stepDetail && (
            <span className="text-gray-400 ml-2">({state.stepDetail})</span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] bg-gray-900 bg-opacity-95 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {state.isComplete ? 'Batch Complete!' : 'Processing Batch'}
            </h2>
            {state.isComplete && (
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {!state.isComplete ? (
            <>
              {/* Current item */}
              <div className="mb-6">
                <p className="text-sm text-gray-500 mb-1">
                  Processing {state.currentIndex + 1} of {templates.length}
                </p>
                <p className="text-xl font-medium text-gray-900">
                  {currentTemplate?.exerciseName || 'Unknown'}
                </p>
              </div>

              {/* Step progress */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <StepIndicator step="downloading" isActive={state.currentStep === 'downloading'} />
                <StepIndicator step="submitting" isActive={state.currentStep === 'submitting'} />
                <StepIndicator step="processing" isActive={state.currentStep === 'processing'} />
                <StepIndicator
                  step="downloading-output"
                  isActive={state.currentStep === 'downloading-output'}
                />
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6 text-sm">
                <span className="text-green-600">
                  <span className="font-medium">{completedCount}</span> completed
                </span>
                <span className="text-red-600">
                  <span className="font-medium">{failedCount}</span> failed
                </span>
                <span className="text-gray-500">
                  <span className="font-medium">{remainingCount}</span> remaining
                </span>
              </div>

              {/* Note */}
              <p className="mt-4 text-xs text-gray-400">
                Videos will auto-download to your Downloads folder as they complete.
                <br />
                Keep this window open until processing finishes.
              </p>
            </>
          ) : (
            <>
              {/* Completed exercises section */}
              {completedCount > 0 && (
                <div className="mb-6">
                  <div className="flex items-center gap-2 text-green-600 mb-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="font-semibold">
                      {completedCount} Completed
                    </span>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3">
                    {state.results
                      .filter((r) => r.status === 'completed')
                      .map((result) => (
                        <div
                          key={result.template.id}
                          className="flex items-center gap-2 py-1"
                        >
                          <svg
                            className="w-4 h-4 text-green-500 flex-shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          <span className="text-sm text-green-900">
                            {result.template.exerciseName}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Failed exercises section */}
              {failedCount > 0 && (
                <div className="mb-6">
                  <div className="flex items-center gap-2 text-red-600 mb-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <span className="font-semibold">
                      {failedCount} Failed
                    </span>
                  </div>
                  <div className="bg-red-50 rounded-lg divide-y divide-red-100">
                    {state.results
                      .filter((r) => r.status === 'failed')
                      .map((result) => (
                        <div
                          key={result.template.id}
                          className="p-3"
                        >
                          <div className="flex items-center gap-2">
                            <svg
                              className="w-4 h-4 text-red-500 flex-shrink-0"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                            <span className="text-sm font-medium text-red-900">
                              {result.template.exerciseName}
                            </span>
                          </div>
                          {result.error && (
                            <p className="text-sm text-red-700 mt-1 ml-6">
                              {getHumanReadableError(result.error)}
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Saving indicator */}
              {state.isSaving && (
                <div className="flex items-center justify-center gap-2 text-gray-500 mb-4">
                  <svg
                    className="animate-spin w-4 h-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span className="text-sm">Saving to library...</span>
                </div>
              )}

              {/* Close button */}
              {!state.isSaving && (
                <div className="flex justify-center">
                  <button
                    onClick={handleClose}
                    className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
