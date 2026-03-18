'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ExerciseEntry } from '@/types';
import { Badge } from './ui/Badge';

interface ProjectExerciseTableProps {
  exercises: ExerciseEntry[];
  onViewVideo: (exercise: ExerciseEntry) => void;
  onRemove: (id: string) => void;
  // Selection
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  // Sorting
  sortColumn?: 'name' | 'equipment' | null;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: 'name' | 'equipment') => void;
}

/**
 * Simplified exercise table for project view
 * - Only shows Name and Equipment columns
 * - Selection for batch operations
 * - No inline editing capabilities
 */
export default function ProjectExerciseTable({
  exercises,
  onViewVideo,
  onRemove,
  selectedIds,
  onSelectionChange,
  sortColumn,
  sortDirection = 'asc',
  onSort,
}: ProjectExerciseTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Handle row click for selection (Google Drive style)
  const handleRowClick = useCallback((e: React.MouseEvent, index: number, exerciseId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) {
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
    }

    const isShiftKey = e.shiftKey;
    const isMetaKey = e.metaKey || e.ctrlKey;

    if (isShiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIds = exercises.slice(start, end + 1).map(ex => ex.id);

      if (isMetaKey) {
        const newSelection = new Set(selectedIds);
        rangeIds.forEach(id => newSelection.add(id));
        onSelectionChange(newSelection);
      } else {
        onSelectionChange(new Set(rangeIds));
      }
    } else if (isMetaKey) {
      const newSelection = new Set(selectedIds);
      if (newSelection.has(exerciseId)) {
        newSelection.delete(exerciseId);
      } else {
        newSelection.add(exerciseId);
      }
      onSelectionChange(newSelection);
      setLastSelectedIndex(index);
    } else {
      if (selectedIds.has(exerciseId) && selectedIds.size === 1) {
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
      if (e.key === 'Escape' && selectedIds.size > 0) {
        onSelectionChange(new Set());
        setLastSelectedIndex(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedIds, onSelectionChange]);

  const hasSelection = selectedIds.size > 0;
  const selectedExercise = selectedIds.size === 1
    ? exercises.find(e => selectedIds.has(e.id))
    : null;

  const handleSelectAll = () => {
    if (selectedIds.size === exercises.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(exercises.map(e => e.id)));
    }
  };

  return (
    <div>
      {/* Action bar */}
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
            {selectedIds.size === 1 && selectedExercise?.outputVideoUrl && (
              <button
                onClick={() => selectedExercise && onViewVideo(selectedExercise)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                View
              </button>
            )}

            {/* Remove from project - single item only */}
            {selectedIds.size === 1 && (
              <button
                onClick={() => {
                  if (selectedExercise && confirm('Remove this exercise from the project? (It will still be in your library)')) {
                    onRemove(selectedExercise.id);
                    onSelectionChange(new Set());
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Remove
              </button>
            )}
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-gray-700">
              {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
            </span>
            <div className="flex-1" />
            <button
              onClick={handleSelectAll}
              className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
            >
              Select All
            </button>
          </>
        )}
      </div>

      <div
        ref={tableRef}
        className="overflow-x-auto rounded-b-xl border-x border-b border-gray-200 shadow-sm focus:outline-none select-none bg-gray-50"
        tabIndex={0}
      >
        <table className="w-full">
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
                onClick={() => onSort?.('equipment')}
                className={`w-[140px] px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider ${onSort ? 'cursor-pointer hover:bg-gray-100' : ''}`}
              >
                <div className="flex items-center gap-1">
                  Equipment
                  {sortColumn === 'equipment' && (
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
                  onDoubleClick={() => exercise.outputVideoUrl && onViewVideo(exercise)}
                  className={`group cursor-pointer transition-colors ${
                    isRowSelected
                      ? 'bg-blue-100'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-900">{exercise.exerciseName || '—'}</span>
                  </td>

                  {/* Equipment */}
                  <td className="px-4 py-3">
                    {exercise.equipmentType ? (
                      <Badge variant="equipment" value={exercise.equipmentType} />
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
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
