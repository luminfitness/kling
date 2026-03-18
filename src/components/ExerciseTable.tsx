'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ExerciseEntry, ExerciseMetadata, Position } from '@/types';
import { Badge } from './ui/Badge';

// Format date as "Feb 8, 12:14 PM" in Dallas timezone
function formatCompletedDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Chicago',
  }) + ', ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Chicago',
  });
}

// Component to display video duration, fetching from video metadata if not stored
function VideoDuration({ exercise }: { exercise: ExerciseEntry }) {
  const [duration, setDuration] = useState<number | null>(exercise.videoDurationSec ?? null);
  const [loading, setLoading] = useState(!exercise.videoDurationSec);

  useEffect(() => {
    if (exercise.videoDurationSec || !exercise.outputVideoUrl) {
      setLoading(false);
      return;
    }

    // Fetch duration from video metadata
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      setDuration(video.duration);
      setLoading(false);
    };
    video.onerror = () => {
      setLoading(false);
    };
    video.src = exercise.outputVideoUrl;

    return () => {
      video.onloadedmetadata = null;
      video.onerror = null;
    };
  }, [exercise.videoDurationSec, exercise.outputVideoUrl]);

  if (loading) {
    return <span className="text-sm text-gray-400">...</span>;
  }

  if (duration) {
    return <span className="text-sm text-gray-600">{Math.round(duration)}s</span>;
  }

  return <span className="text-sm text-gray-400">—</span>;
}

interface ExerciseTableProps {
  exercises: ExerciseEntry[];
  onUpdate: (id: string, updates: Partial<Pick<ExerciseEntry, 'exerciseName' | 'equipmentType' | 'reviewed' | 'flagged' | 'rerunning' | 'positionId' | 'positionName'> & ExerciseMetadata>) => void;
  onDelete: (id: string) => void;
  onViewVideo: (exercise: ExerciseEntry) => void;
  onRerun: (exercise: ExerciseEntry) => void;
  equipmentOptions: string[];
  positions?: Position[];
  // Selection - Google Drive style
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  // Sorting
  sortColumn?: 'name' | 'equipment' | 'completed' | null;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: 'name' | 'equipment' | 'completed') => void;
  // Bulk actions
  onBulkDownload?: () => void;
  onAddToProject?: () => void;
  isDownloading?: boolean;
  onBulkEquipmentChange?: (ids: string[], equipment: string) => void;
  onBulkPositionChange?: (ids: string[], positionId: string, positionName: string) => void;
  onBulkDelete?: (ids: string[]) => void;
  onBulkRerun?: (ids: string[]) => void;
  onBulkReview?: (ids: string[]) => void;
  onBulkStatusChange?: (ids: string[], status: 'reviewed' | 'flagged' | 'clear') => void;
  // Bulk review modal
  onOpenBulkReviewModal?: () => void;
  reviewableCount?: number; // Count of flagged or unreviewed items
  // Custom position
  onAddCustomPosition?: () => void;
}

export default function ExerciseTable({
  exercises,
  onUpdate,
  onDelete,
  onViewVideo,
  onRerun,
  equipmentOptions: equipmentOptionsProp,
  positions = [],
  selectedIds,
  onSelectionChange,
  sortColumn,
  sortDirection = 'asc',
  onSort,
  onBulkDownload,
  onAddToProject,
  isDownloading = false,
  onBulkEquipmentChange,
  onBulkPositionChange,
  onBulkDelete,
  onBulkRerun,
  onBulkReview,
  onBulkStatusChange,
  onOpenBulkReviewModal,
  reviewableCount = 0,
  onAddCustomPosition,
}: ExerciseTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const equipmentOptions = equipmentOptionsProp.map((e) => ({ value: e, label: e }));
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Dropdown states
  const [showEquipmentDropdown, setShowEquipmentDropdown] = useState(false);
  const [showPositionDropdown, setShowPositionDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showRenameInput, setShowRenameInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [originalValue, setOriginalValue] = useState('');

  const equipmentRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDivElement>(null);

  // Get selected exercise for single-item actions
  const selectedExercise = selectedIds.size === 1
    ? exercises.find(e => selectedIds.has(e.id))
    : null;

  // Download handler that fetches blob for cross-origin URLs
  const handleDownload = async (exercise: ExerciseEntry) => {
    if (!exercise.outputVideoUrl) return;
    setDownloadingId(exercise.id);
    try {
      const res = await fetch(exercise.outputVideoUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exercise.exerciseName?.replace(/\s+/g, '-').toLowerCase() || 'exercise'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      window.open(exercise.outputVideoUrl, '_blank');
    } finally {
      setDownloadingId(null);
    }
  };

  // Handle row click for selection (Google Drive style)
  const handleRowClick = useCallback((e: React.MouseEvent, index: number, exerciseId: string) => {
    // Don't select if clicking on action buttons or during editing
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    // Prevent text selection on shift+click
    if (e.shiftKey) {
      e.preventDefault();
    }

    const isShiftKey = e.shiftKey;
    const isMetaKey = e.metaKey || e.ctrlKey;

    if (isShiftKey && lastSelectedIndex !== null) {
      // Shift+click: select range
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIds = exercises.slice(start, end + 1).map(ex => ex.id);

      if (isMetaKey) {
        // Shift+Cmd: add range to existing selection
        const newSelection = new Set(selectedIds);
        rangeIds.forEach(id => newSelection.add(id));
        onSelectionChange(newSelection);
      } else {
        // Shift only: replace selection with range
        onSelectionChange(new Set(rangeIds));
      }
    } else if (isMetaKey) {
      // Cmd/Ctrl+click: toggle individual item
      const newSelection = new Set(selectedIds);
      if (newSelection.has(exerciseId)) {
        newSelection.delete(exerciseId);
      } else {
        newSelection.add(exerciseId);
      }
      onSelectionChange(newSelection);
      setLastSelectedIndex(index);
    } else {
      // Normal click: select only this item (clear others)
      if (selectedIds.has(exerciseId) && selectedIds.size === 1) {
        // If clicking on the only selected item, deselect it
        onSelectionChange(new Set());
        setLastSelectedIndex(null);
      } else {
        onSelectionChange(new Set([exerciseId]));
        setLastSelectedIndex(index);
      }
    }
  }, [exercises, selectedIds, lastSelectedIndex, onSelectionChange]);

  // Clear selection on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          onSelectionChange(new Set());
          setLastSelectedIndex(null);
        }
        // Close any open dropdowns
        setShowEquipmentDropdown(false);
        setShowPositionDropdown(false);
        setShowStatusDropdown(false);
        setShowRenameInput(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedIds, onSelectionChange]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (equipmentRef.current && !equipmentRef.current.contains(e.target as Node)) {
        setShowEquipmentDropdown(false);
      }
      if (positionRef.current && !positionRef.current.contains(e.target as Node)) {
        setShowPositionDropdown(false);
      }
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setShowStatusDropdown(false);
      }
      if (renameRef.current && !renameRef.current.contains(e.target as Node)) {
        setShowRenameInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasSelection = selectedIds.size > 0;

  // Action handlers
  const handleEquipmentChange = (equipment: string) => {
    if (onBulkEquipmentChange) {
      onBulkEquipmentChange(Array.from(selectedIds), equipment);
    } else {
      selectedIds.forEach(id => {
        onUpdate(id, { equipmentType: equipment });
      });
    }
    setShowEquipmentDropdown(false);
  };

  const handlePositionChange = (positionId: string, positionName: string) => {
    if (onBulkPositionChange) {
      onBulkPositionChange(Array.from(selectedIds), positionId, positionName);
    } else {
      selectedIds.forEach(id => {
        onUpdate(id, { positionId, positionName });
      });
    }
    setShowPositionDropdown(false);
  };

  const handleRename = () => {
    if (selectedExercise && inputValue.trim()) {
      onUpdate(selectedExercise.id, { exerciseName: inputValue.trim() });
    }
    setShowRenameInput(false);
    setInputValue('');
  };

  const handleViewVideo = () => {
    if (selectedExercise) {
      onViewVideo(selectedExercise);
    }
  };

  const handleSingleDownload = () => {
    if (selectedExercise) {
      handleDownload(selectedExercise);
    }
  };

  const handleRerun = () => {
    if (selectedIds.size === 1 && selectedExercise) {
      onRerun(selectedExercise);
    } else if (onBulkRerun) {
      onBulkRerun(Array.from(selectedIds));
    }
  };

  const handleDelete = () => {
    if (!confirm(`Delete ${selectedIds.size} exercise${selectedIds.size > 1 ? 's' : ''}?`)) return;
    if (onBulkDelete) {
      onBulkDelete(Array.from(selectedIds));
    } else {
      selectedIds.forEach(id => onDelete(id));
    }
    onSelectionChange(new Set());
  };

  const handleBulkReview = () => {
    if (onBulkReview) {
      onBulkReview(Array.from(selectedIds));
    } else {
      selectedIds.forEach(id => {
        onUpdate(id, { reviewed: true, flagged: false });
      });
    }
  };

  const handleStatusChange = (status: 'reviewed' | 'flagged' | 'clear') => {
    if (onBulkStatusChange) {
      onBulkStatusChange(Array.from(selectedIds), status);
    } else {
      selectedIds.forEach(id => {
        if (status === 'reviewed') {
          onUpdate(id, { reviewed: true, flagged: false });
        } else if (status === 'flagged') {
          onUpdate(id, { reviewed: false, flagged: true });
        } else {
          onUpdate(id, { reviewed: false, flagged: false });
        }
      });
    }
    setShowStatusDropdown(false);
  };

  return (
    <div>
      {/* Action bar - sticky at top of viewport */}
      <div className="sticky top-0 z-30 flex items-center gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-t-xl shadow-sm select-none overflow-visible">
        {hasSelection ? (
          <>
            <button
              onClick={() => {
                onSelectionChange(new Set());
                setLastSelectedIndex(null);
              }}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
              title="Clear selection (Esc)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <span className="text-sm font-medium text-gray-700">
              {selectedIds.size} selected
            </span>
            <div className="flex-1" />

            {/* View Video - single item only */}
            {selectedIds.size === 1 && (
              <button
                onClick={handleViewVideo}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                View
              </button>
            )}

            {/* Status dropdown */}
            <div
              ref={statusRef}
              className="relative"
              onMouseEnter={() => setShowStatusDropdown(true)}
              onMouseLeave={() => setShowStatusDropdown(false)}
            >
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Status
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-0 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  <button
                    onClick={() => handleStatusChange('reviewed')}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Mark Reviewed
                  </button>
                  <button
                    onClick={() => handleStatusChange('flagged')}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-orange-500" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                    </svg>
                    Mark Flagged
                  </button>
                  <button
                    onClick={() => handleStatusChange('clear')}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Clear Status
                  </button>
                </div>
              )}
            </div>

            {/* Download */}
            {selectedIds.size === 1 ? (
              <button
                onClick={handleSingleDownload}
                disabled={downloadingId === selectedExercise?.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {downloadingId === selectedExercise?.id ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                Download
              </button>
            ) : onBulkDownload && (
              <button
                onClick={onBulkDownload}
                disabled={isDownloading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {isDownloading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                Download
              </button>
            )}

            {/* Rename - single item only */}
            {selectedIds.size === 1 && (
              <div ref={renameRef} className="relative">
                <button
                  onClick={() => {
                    const val = selectedExercise?.exerciseName || '';
                    setInputValue(val);
                    setOriginalValue(val);
                    setShowRenameInput(!showRenameInput);
                    setShowEquipmentDropdown(false);
                    setShowPositionDropdown(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Rename
                </button>
                {showRenameInput && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder="Exercise name"
                      autoFocus
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                        if (e.key === 'Escape') {
                          setInputValue(originalValue);
                          setShowRenameInput(false);
                        }
                      }}
                      onBlur={() => {
                        handleRename();
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Equipment dropdown - hover to show */}
            <div
              ref={equipmentRef}
              className="relative"
              onMouseEnter={() => setShowEquipmentDropdown(true)}
              onMouseLeave={() => setShowEquipmentDropdown(false)}
            >
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Equipment
              </button>
              {showEquipmentDropdown && (
                <div className="absolute top-full left-0 mt-0 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {equipmentOptions.map((eq) => (
                    <button
                      key={eq.value}
                      onClick={() => handleEquipmentChange(eq.value)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {eq.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Position dropdown - hover to show */}
            {(positions.length > 0 || onAddCustomPosition) && (
              <div
                ref={positionRef}
                className="relative"
                onMouseEnter={() => setShowPositionDropdown(true)}
                onMouseLeave={() => setShowPositionDropdown(false)}
              >
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Position
                </button>
                {showPositionDropdown && (
                  <div className="absolute top-full left-0 mt-0 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    {onAddCustomPosition && (
                      <button
                        onClick={() => {
                          setShowPositionDropdown(false);
                          onAddCustomPosition();
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-b border-gray-100 flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        Add Custom Position
                      </button>
                    )}
                    {positions.map((pos) => (
                      <button
                        key={pos.id}
                        onClick={() => handlePositionChange(pos.id, pos.name)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        {pos.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Rerun */}
            <button
              onClick={handleRerun}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Rerun
            </button>

            {/* Add to Project */}
            {onAddToProject && (
              <button
                onClick={onAddToProject}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                Add to Project
              </button>
            )}

            {/* Delete */}
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-gray-700">
              Completed ({exercises.length})
            </span>
            <div className="flex-1" />
            {onOpenBulkReviewModal && reviewableCount > 0 && (
              <button
                onClick={onOpenBulkReviewModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                Bulk Review ({reviewableCount})
              </button>
            )}
          </>
        )}
      </div>

      <div
        ref={tableRef}
        className="overflow-x-auto rounded-b-xl border-x border-b border-gray-200 shadow-sm focus:outline-none select-none bg-gray-50"
        tabIndex={0}
      >
        <table className="w-full" style={{ minWidth: '720px' }}>
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th
                onClick={() => onSort?.('name')}
                className={`px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider ${onSort ? 'cursor-pointer hover:bg-gray-100' : ''}`}
              >
                <div className="flex items-center gap-1">
                  Name
                  {sortColumn === 'name' && (
                    <span className="text-blue-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => onSort?.('completed')}
                className={`w-[160px] px-2 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${onSort ? 'cursor-pointer hover:bg-gray-100' : ''}`}
              >
                <div className="flex items-center gap-1">
                  Completed
                  {sortColumn === 'completed' && (
                    <span className="text-blue-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {exercises.map((exercise, rowIdx) => {
              const isRowSelected = selectedIds.has(exercise.id);

              return (
                <tr
                  key={exercise.id}
                  onClick={(e) => handleRowClick(e, rowIdx, exercise.id)}
                  className={`group cursor-pointer transition-colors ${
                    isRowSelected
                      ? 'bg-blue-100'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {/* Name */}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {exercise.rerunning && (
                        <span title="Rerun in progress">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </span>
                      )}
                      <span className="text-sm text-gray-900 truncate">{exercise.exerciseName || '—'}</span>
                    </div>
                  </td>


                  {/* Completed */}
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="text-sm text-gray-600">{formatCompletedDate(exercise.savedAt)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
