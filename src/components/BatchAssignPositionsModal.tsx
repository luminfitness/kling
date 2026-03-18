'use client';

import { useState, useEffect, useRef } from 'react';
import type { ExerciseTemplate, Position } from '@/types';
import { extractStillFrame } from '@/lib/positionGenerator';

interface Props {
  templates: ExerciseTemplate[];
  positions: Position[];
  onClose: () => void;
  onAssign: (templateIds: string[], positionId: string, positionName: string) => Promise<void>;
}

export default function BatchAssignPositionsModal({ templates, positions, onClose, onAssign }: Props) {
  const eligible = templates.filter((t) => !t.positionId && !!t.inputVideoUrl);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());

  // Left panel filters
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [exerciseEquipFilter, setExerciseEquipFilter] = useState('All');

  // Right panel filters
  const [positionSearch, setPositionSearch] = useState('');
  const [positionEquipFilter, setPositionEquipFilter] = useState('All');

  const [assigning, setAssigning] = useState(false);

  const exerciseEquipTypes = ['All', ...Array.from(new Set(eligible.map((t) => t.equipmentType).filter(Boolean)))];
  const positionEquipTypes = ['All', ...Array.from(new Set(positions.map((p) => p.equipmentType).filter(Boolean)))];

  const visibleExercises = eligible.filter((t) => {
    if (assignedIds.has(t.id)) return false;
    if (exerciseEquipFilter !== 'All' && t.equipmentType !== exerciseEquipFilter) return false;
    if (exerciseSearch.trim()) return (t.exerciseName || '').toLowerCase().includes(exerciseSearch.trim().toLowerCase());
    return true;
  });

  const filteredPositions = positions.filter((p) => {
    if (positionEquipFilter !== 'All' && p.equipmentType !== positionEquipFilter) return false;
    if (positionSearch.trim()) return (p.name || '').toLowerCase().includes(positionSearch.trim().toLowerCase());
    return true;
  });

  const toggleExercise = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(visibleExercises.map((t) => t.id)));
  const clearAll = () => setSelectedIds(new Set());

  const handlePositionClick = async (position: Position) => {
    if (selectedIds.size === 0 || assigning) return;
    setAssigning(true);
    const ids = Array.from(selectedIds);
    try {
      await onAssign(ids, position.id, position.name);
      setAssignedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      setSelectedIds(new Set());
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex w-full flex-col rounded-xl bg-white shadow-2xl overflow-hidden"
        style={{ width: '95vw', maxWidth: '1200px', height: '90vh' }}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">Batch Assign Positions</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Select exercises on the left, then click a position on the right to assign
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Split panels */}
        <div className="flex min-h-0 flex-1 overflow-hidden">

          {/* LEFT: Exercises without positions */}
          <div className="flex w-1/2 flex-col border-r">
            {/* Left search + filter */}
            <div className="flex flex-shrink-0 flex-col gap-2 border-b bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <svg className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={exerciseSearch}
                    onChange={(e) => setExerciseSearch(e.target.value)}
                    placeholder="Search exercises..."
                    className="w-full rounded-lg border border-gray-300 py-1.5 pl-7 pr-3 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <select
                  value={exerciseEquipFilter}
                  onChange={(e) => setExerciseEquipFilter(e.target.value)}
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                >
                  {exerciseEquipTypes.map((eq) => (
                    <option key={eq} value={eq}>{eq}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  No Position ({visibleExercises.length})
                </span>
                <div className="flex gap-2">
                  <button onClick={selectAll} disabled={visibleExercises.length === 0} className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400">All</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={clearAll} disabled={selectedIds.size === 0} className="text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-400">None</button>
                </div>
              </div>
            </div>

            {/* Left grid */}
            <div className="flex-1 overflow-y-auto p-3">
              {visibleExercises.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">
                  {eligible.length === 0
                    ? 'All exercises already have position images.'
                    : assignedIds.size === eligible.length
                    ? 'All done! Every exercise has been assigned.'
                    : 'No exercises match your search.'}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {visibleExercises.map((t) => (
                    <ExerciseCard
                      key={t.id}
                      template={t}
                      isSelected={selectedIds.has(t.id)}
                      onToggle={() => toggleExercise(t.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Left footer */}
            {selectedIds.size > 0 && (
              <div className="flex-shrink-0 border-t bg-blue-50 px-4 py-2 text-xs text-blue-700">
                {selectedIds.size} selected — click a position →
              </div>
            )}
          </div>

          {/* RIGHT: Positions */}
          <div className="flex w-1/2 flex-col">
            {/* Right search + filter */}
            <div className="flex flex-shrink-0 items-center gap-2 border-b bg-gray-50 px-4 py-3">
              <div className="relative flex-1">
                <svg className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={positionSearch}
                  onChange={(e) => setPositionSearch(e.target.value)}
                  placeholder="Search positions..."
                  className="w-full rounded-lg border border-gray-300 py-1.5 pl-7 pr-3 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <select
                value={positionEquipFilter}
                onChange={(e) => setPositionEquipFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              >
                {positionEquipTypes.map((eq) => (
                  <option key={eq} value={eq}>{eq}</option>
                ))}
              </select>
            </div>

            {/* Right grid */}
            <div className="flex-1 overflow-y-auto p-3">
              {filteredPositions.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  No positions found.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {filteredPositions.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handlePositionClick(p)}
                      disabled={selectedIds.size === 0 || assigning}
                      className={`group relative overflow-hidden rounded-lg border-2 text-left transition-all ${
                        selectedIds.size > 0 && !assigning
                          ? 'border-gray-200 hover:border-green-400 hover:shadow-md cursor-pointer'
                          : 'border-gray-200 cursor-default opacity-50'
                      }`}
                    >
                      {p.publicUrl ? (
                        <img src={p.publicUrl} alt={p.name} className="aspect-[9/16] w-full object-cover object-top" />
                      ) : (
                        <div className="flex aspect-[9/16] w-full items-center justify-center bg-gray-100">
                          <span className="text-xs text-gray-400">No image</span>
                        </div>
                      )}
                      <div className="p-2">
                        <p className="truncate text-xs font-medium text-gray-900">{p.name}</p>
                        {p.equipmentType && <p className="truncate text-xs text-gray-500">{p.equipmentType}</p>}
                      </div>
                      {selectedIds.size > 0 && !assigning && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-600/0 transition-all group-hover:bg-green-600/20">
                          <span className="scale-75 rounded-full bg-green-600 px-2 py-1 text-xs font-medium text-white opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100">
                            Assign {selectedIds.size}
                          </span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {assigning && (
              <div className="flex flex-shrink-0 items-center justify-center gap-2 border-t bg-gray-50 px-4 py-2 text-sm text-gray-500">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t bg-gray-50 px-5 py-3">
          <span className="text-xs text-gray-500">
            {assignedIds.size > 0 ? `${assignedIds.size} assigned this session` : 'No assignments yet'}
          </span>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ExerciseCard ─────────────────────────────────────────────────────────────

function ExerciseCard({ template, isSelected, onToggle }: {
  template: ExerciseTemplate; isSelected: boolean; onToggle: () => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const loaded = useRef(false);
  const cardRef = useRef<HTMLButtonElement>(null);

  // Lazy-load: only extract frame when card scrolls into view
  useEffect(() => {
    if (loaded.current || !template.inputVideoUrl || !cardRef.current) return;
    const el = cardRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loaded.current = true;
          observer.disconnect();
          extractStillFrame(template.inputVideoUrl!).then(setThumb).catch(() => {});
        }
      },
      { rootMargin: '200px' } // start loading 200px before visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [template.inputVideoUrl]);

  return (
    <button
      ref={cardRef}
      onClick={onToggle}
      className={`relative overflow-hidden rounded-lg border-2 text-left transition-all ${
        isSelected ? 'border-blue-500 shadow-md' : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
      }`}
    >
      {thumb ? (
        <img src={thumb} alt={template.exerciseName || ''} className="aspect-[3/4] w-full object-cover" />
      ) : (
        <div className="flex aspect-[3/4] w-full items-center justify-center bg-gray-100">
          {template.inputVideoUrl ? (
            <svg className="h-5 w-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          )}
        </div>
      )}
      <div className="p-1.5">
        <p className="truncate text-xs font-medium text-gray-900">{template.exerciseName || 'Exercise'}</p>
        {template.equipmentType && <p className="truncate text-xs text-gray-500">{template.equipmentType}</p>}
      </div>
      {isSelected && (
        <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
          <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </button>
  );
}
