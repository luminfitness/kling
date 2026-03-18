'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useExerciseTemplates } from '@/hooks/useExerciseTemplates';
import { extractStillFrame } from '@/lib/positionGenerator';
import { extractFrames } from '@/lib/frameExtractor';

interface Props {
  onClose: () => void;
  onAddFrames: (dataUrls: string[]) => void;
}

export default function ExerciseFramePickerModal({ onClose, onAddFrames }: Props) {
  const { templates } = useExerciseTemplates();
  const eligibleTemplates = templates.filter((t) => !t.positionId && !!t.inputVideoUrl);

  const [search, setSearch] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState('All');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Cache thumbnails (auto-extracted or user-selected frame)
  const thumbCache = useRef<Record<string, string>>({});
  // User-selected custom frames override auto-extracted thumbs
  const [customThumbs, setCustomThumbs] = useState<Record<string, string>>({});
  // Which exercise is open in the frame scrubber
  const [scrubTarget, setScrubTarget] = useState<{ id: string; videoUrl: string; name: string } | null>(null);

  const equipmentTypes = ['All', ...Array.from(new Set(eligibleTemplates.map((t) => t.equipmentType).filter(Boolean)))];

  const filtered = eligibleTemplates.filter((t) => {
    if (equipmentFilter !== 'All' && t.equipmentType !== equipmentFilter) return false;
    if (search.trim()) return (t.exerciseName || '').toLowerCase().includes(search.trim().toLowerCase());
    return true;
  });

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onThumbLoaded = useCallback((id: string, dataUrl: string) => {
    if (!thumbCache.current[id]) {
      thumbCache.current[id] = dataUrl;
    }
  }, []);

  const onSelectCustomFrame = useCallback((id: string, dataUrl: string) => {
    thumbCache.current[id] = dataUrl;
    setCustomThumbs((prev) => ({ ...prev, [id]: dataUrl }));
    setScrubTarget(null);
  }, []);

  const handleAdd = () => {
    const frames = Array.from(selectedIds)
      .map((id) => thumbCache.current[id])
      .filter(Boolean) as string[];
    if (frames.length > 0) {
      onAddFrames(frames);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold text-gray-900">Browse Exercises</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-shrink-0 gap-2 border-b px-4 py-3">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exercises..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select
            value={equipmentFilter}
            onChange={(e) => setEquipmentFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            {equipmentTypes.map((eq) => (
              <option key={eq} value={eq}>{eq}</option>
            ))}
          </select>
        </div>

        {/* Grid — relative so frame scrubber panel can overlay it */}
        <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
          {eligibleTemplates.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              No pending exercises with downloaded videos found.
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              No exercises match your search.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {filtered.map((t) => (
                <ThumbCard
                  key={t.id}
                  id={t.id}
                  name={t.exerciseName || ''}
                  equipment={t.equipmentType || ''}
                  videoUrl={t.inputVideoUrl!}
                  isSelected={selectedIds.has(t.id)}
                  customThumb={customThumbs[t.id]}
                  onToggle={() => toggle(t.id)}
                  onThumbLoaded={(dataUrl) => onThumbLoaded(t.id, dataUrl)}
                  onPickFrame={() => setScrubTarget({ id: t.id, videoUrl: t.inputVideoUrl!, name: t.exerciseName || '' })}
                />
              ))}
            </div>
          )}

          {/* Frame scrubber overlay */}
          {scrubTarget && (
            <FrameScrubberPanel
              id={scrubTarget.id}
              videoUrl={scrubTarget.videoUrl}
              name={scrubTarget.name}
              onSelect={(dataUrl) => onSelectCustomFrame(scrubTarget.id, dataUrl)}
              onClose={() => setScrubTarget(null)}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t px-4 py-3">
          <span className="text-sm text-gray-500">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Click exercises to select'}
          </span>
          <button
            onClick={handleAdd}
            disabled={selectedIds.size === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {selectedIds.size === 0 ? 'Select exercises to add' : `Add ${selectedIds.size} to batch`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ThumbCard ────────────────────────────────────────────────────────────────

function ThumbCard({
  id, name, equipment, videoUrl, isSelected, customThumb, onToggle, onThumbLoaded, onPickFrame,
}: {
  id: string; name: string; equipment: string; videoUrl: string;
  isSelected: boolean; customThumb?: string; onToggle: () => void;
  onThumbLoaded: (url: string) => void; onPickFrame: () => void;
}) {
  const [autoThumb, setAutoThumb] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    extractStillFrame(videoUrl)
      .then((url) => { setAutoThumb(url); onThumbLoaded(url); })
      .catch(() => setError(true));
  }, [videoUrl, onThumbLoaded]);

  const displayThumb = customThumb || autoThumb;

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`group relative w-full overflow-hidden rounded-lg border-2 text-left transition-all ${
          isSelected ? 'border-blue-500 shadow-md' : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
        }`}
      >
        {displayThumb ? (
          <img src={displayThumb} alt={name} className="aspect-[3/4] w-full object-cover" />
        ) : error ? (
          <div className="flex aspect-[3/4] w-full items-center justify-center bg-gray-100">
            <span className="text-xs text-gray-400">No preview</span>
          </div>
        ) : (
          <div className="flex aspect-[3/4] w-full items-center justify-center bg-gray-100">
            <svg className="h-5 w-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}
        <div className="p-1.5">
          <p className="truncate text-xs font-medium text-gray-900">{name || 'Exercise'}</p>
          {equipment && <p className="truncate text-xs text-gray-500">{equipment}</p>}
        </div>
        {isSelected && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
            <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </button>

      {/* Filmstrip button — pick a different frame */}
      {!error && (
        <button
          onClick={(e) => { e.stopPropagation(); onPickFrame(); }}
          title="Pick a different frame"
          className="absolute bottom-8 left-1.5 flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white hover:bg-black/70"
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm1-4V5h-1v2h1zM5 5v2H4V5h1zm-1 4h1v2H4V9zm0 4h1v2H4v-2z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── FrameScrubberPanel ───────────────────────────────────────────────────────

function FrameScrubberPanel({
  videoUrl, name, onSelect, onClose,
}: {
  id: string; videoUrl: string; name: string;
  onSelect: (dataUrl: string) => void; onClose: () => void;
}) {
  const [frames, setFrames] = useState<{ time: number; dataUrl: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    extractFrames(videoUrl, 1, 16)
      .then((fs) => { setFrames(fs); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [videoUrl]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col rounded-xl bg-white">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{name}</p>
          <p className="text-xs text-gray-500">Click any frame to use it as the thumbnail</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Frames grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-gray-500">
            <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Extracting frames...
          </div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-sm text-gray-500">
            Could not extract frames from this video.
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {frames.map((f, i) => (
              <button
                key={i}
                onClick={() => onSelect(f.dataUrl)}
                className="relative overflow-hidden rounded-lg border-2 border-transparent hover:border-blue-400 focus:border-blue-500 focus:outline-none bg-black"
              >
                <img src={f.dataUrl} alt={`Frame at ${f.time.toFixed(1)}s`} className="aspect-[9/16] w-full object-contain" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 py-0.5 text-center text-xs text-white">
                  {f.time.toFixed(1)}s
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
