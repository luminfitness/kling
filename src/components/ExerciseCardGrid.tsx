'use client';

import { useState, useRef, useEffect } from 'react';
import type { ExerciseEntry } from '@/types';
import { Badge } from './ui/Badge';

interface ExerciseCardGridProps {
  exercises: ExerciseEntry[];
  onViewVideo: (exercise: ExerciseEntry) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

export default function ExerciseCardGrid({
  exercises,
  onViewVideo,
  selectedIds,
  onSelectionChange,
}: ExerciseCardGridProps) {
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Handle card click for selection
  const handleCardClick = (e: React.MouseEvent, index: number, exerciseId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    if (e.shiftKey) e.preventDefault();

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
  };

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

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {exercises.map((exercise, idx) => {
        const isSelected = selectedIds.has(exercise.id);
        return (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            isSelected={isSelected}
            onClick={(e) => handleCardClick(e, idx, exercise.id)}
            onDoubleClick={() => onViewVideo(exercise)}
          />
        );
      })}
    </div>
  );
}

function ExerciseCard({
  exercise,
  isSelected,
  onClick,
  onDoubleClick,
}: {
  exercise: ExerciseEntry;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovering, setIsHovering] = useState(false);

  // Play video on hover
  useEffect(() => {
    if (videoRef.current) {
      if (isHovering) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [isHovering]);

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={`relative flex flex-col rounded-xl overflow-hidden cursor-pointer transition-all select-none ${
        isSelected
          ? 'ring-2 ring-blue-500 bg-blue-50'
          : 'bg-white border border-gray-200 hover:shadow-md'
      }`}
    >
      {/* Video thumbnail */}
      <div className="relative aspect-square bg-gray-100 overflow-hidden">
        {exercise.outputVideoUrl ? (
          <video
            ref={videoRef}
            src={exercise.outputVideoUrl}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}

        {/* Status indicator */}
        <div className="absolute top-2 right-2">
          {exercise.rerunning ? (
            <div className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center" title="Rerun in progress">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          ) : exercise.flagged ? (
            <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center" title="Flagged">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-orange-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
              </svg>
            </div>
          ) : exercise.reviewed ? (
            <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center" title="Reviewed">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : null}
        </div>

        {/* Play icon on hover */}
        {isHovering && !isSelected && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-700 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="p-3">
        <h3 className="text-sm font-medium text-gray-900 truncate" title={exercise.exerciseName}>
          {exercise.exerciseName || 'Untitled'}
        </h3>
        {exercise.equipmentType && (
          <div className="mt-1.5">
            <Badge variant="equipment" value={exercise.equipmentType} className="text-[10px] px-1.5 py-0.5" />
          </div>
        )}
      </div>
    </div>
  );
}
