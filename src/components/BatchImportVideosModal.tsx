'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { trimVideo } from '@/lib/videoTrimmer';
import { uploadTrimmedVideo } from '@/lib/videoDownload';
import { autoGeneratePosition, findReferencePosition } from '@/lib/positionGenerator';
import type { ExerciseTemplate, Position } from '@/types';


interface BatchImportVideosModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: ExerciseTemplate[];
  positions: Position[];
  onUpdateTemplate: (id: string, updates: Partial<ExerciseTemplate>) => Promise<void>;
  onAddTemplate: (template: Omit<ExerciseTemplate, 'id' | 'createdAt'>) => Promise<ExerciseTemplate>;
  onCreatePosition: (name: string, equipmentType: string, imageFile: File) => Promise<Position>;
}

type Phase = 'upload' | 'trim' | 'processing' | 'complete';

interface ImportedVideo {
  id: string;
  fileName: string;
  file?: File;
  storageUrl: string;
  startTime: string;
  endTime: string;
  trimmedUrl?: string;
  positionFile?: File;
  assignedTemplateId?: string;
  // From spreadsheet paste — used to create new template if no assignedTemplateId
  pastedExerciseName?: string;
  pastedEquipment?: string;
  status: 'uploading' | 'uploaded' | 'trimming' | 'trimmed' | 'generating' | 'saving' | 'ready' | 'failed';
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTSV(text: string): string[][] {
  return text.trim().split('\n').map(row => row.split('\t').map(cell => cell.trim()));
}

function autoDetectColumns(headers: string[]): { nameIdx: number; equipIdx: number; startIdx: number; endIdx: number } {
  const lower = headers.map(h => h.toLowerCase());
  const nameIdx = lower.findIndex(h =>
    h.includes('exercise') || h.includes('name') || h.includes('title') || h === 'ex' || h === 'movement'
  );
  const equipIdx = lower.findIndex(h =>
    h.includes('equip') || h.includes('gear') || h.includes('tool') || h.includes('apparatus')
  );
  const startIdx = lower.findIndex(h =>
    h.includes('start') || h.includes('from') || h.includes('begin') || h === 'in'
  );
  const endIdx = lower.findIndex(h =>
    h.includes('end') || h === 'to' || h.includes('finish') || h === 'out' || h.includes('stop')
  );
  return { nameIdx, equipIdx, startIdx, endIdx };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ── Searchable Exercise Dropdown ──────────────────────────────────────────────

function ExerciseSearchDropdown({
  videoId,
  value,
  options,
  pastedTimings,
  onSelect,
}: {
  videoId: string;
  value: string | undefined;
  options: ExerciseTemplate[];
  pastedTimings: Map<string, { startTime: string; endTime: string }>;
  onSelect: (videoId: string, templateId: string | undefined) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = options.find(t => t.id === value) ?? null;
  // Also check if current was assigned but filtered out (assigned to this video but not in options)
  const filtered = options.filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      t.exerciseName.toLowerCase().includes(s) ||
      (t.equipmentType ?? '').toLowerCase().includes(s)
    );
  });

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const open = () => {
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger / Search input */}
      <div
        onClick={open}
        className="flex items-center gap-2 w-full px-2.5 py-2 text-sm border border-gray-300 rounded-md cursor-pointer hover:border-gray-400 bg-white select-none"
      >
        {isOpen ? (
          <input
            ref={inputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={current ? current.exerciseName : 'Search exercises…'}
            className="flex-1 outline-none bg-transparent text-sm placeholder-gray-400 min-w-0"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Escape') { setIsOpen(false); setSearch(''); }
              if (e.key === 'Enter' && filtered.length === 1) {
                onSelect(videoId, filtered[0].id);
                setIsOpen(false);
                setSearch('');
              }
            }}
          />
        ) : (
          <span className={`flex-1 truncate text-sm min-w-0 ${current ? 'text-gray-800' : 'text-gray-400'}`}>
            {current
              ? `${current.exerciseName}${current.equipmentType ? ` · ${current.equipmentType}` : ''}`
              : 'Search exercises…'}
          </span>
        )}
        {value && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSelect(videoId, undefined); }}
            className="text-gray-400 hover:text-red-500 flex-shrink-0 p-0.5 rounded"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <svg
          className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">
              {search ? `No matches for "${search}"` : 'All exercises assigned'}
            </div>
          ) : (
            filtered.map(t => {
              const timing = pastedTimings.get(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onSelect(videoId, t.id); setIsOpen(false); setSearch(''); }}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
                >
                  <span className="font-medium text-gray-800 truncate">{t.exerciseName}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {timing && (
                      <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                        {timing.startTime}s–{timing.endTime}s
                      </span>
                    )}
                    {t.equipmentType && (
                      <span className="text-xs text-gray-400 whitespace-nowrap">{t.equipmentType}</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function BatchImportVideosModal({
  isOpen,
  onClose,
  templates,
  positions,
  onUpdateTemplate,
  onAddTemplate,
  onCreatePosition,
}: BatchImportVideosModalProps) {
  const [phase, setPhase] = useState<Phase>('upload');
  const [videos, setVideos] = useState<ImportedVideo[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(-1);
  const [processingStep, setProcessingStep] = useState('');
  const [generatePositions, setGeneratePositions] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Paste state
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteHeaders, setPasteHeaders] = useState<string[]>([]);
  const [pasteDataRows, setPasteDataRows] = useState<string[][]>([]);
  const [pasteColName, setPasteColName] = useState(-1);
  const [pasteColStart, setPasteColStart] = useState(-1);
  const [pasteColEnd, setPasteColEnd] = useState(-1);
  const [pastedTimings, setPastedTimings] = useState<Map<string, { startTime: string; endTime: string }>>(new Map());
  const [pasteResult, setPasteResult] = useState<{ matched: number; unmatched: number } | null>(null);
  const [pastedOrder, setPastedOrder] = useState<{ name: string; equipment: string; startTime: string; endTime: string }[]>([]);
  const [pasteColEquip, setPasteColEquip] = useState(-1);

  const eligibleTemplates = templates.filter(t => !t.inputVideoUrl);

  const updateVideo = useCallback((id: string, updates: Partial<ImportedVideo>) => {
    setVideos(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
  }, []);

  // ── Paste handlers ────────────────────────────────────────────────────────

  const handlePasteText = useCallback((text: string) => {
    const rows = parseTSV(text);
    if (rows.length < 2) return;
    const headers = rows[0];
    const data = rows.slice(1).filter(r => r.some(c => c));
    setPasteHeaders(headers);
    setPasteDataRows(data);
    setPasteResult(null);
    const detected = autoDetectColumns(headers);
    setPasteColName(detected.nameIdx);
    setPasteColEquip(detected.equipIdx);
    setPasteColStart(detected.startIdx);
    setPasteColEnd(detected.endIdx);
  }, []);

  const handleApplyPaste = useCallback(() => {
    if (pasteColName < 0 || pasteColStart < 0 || pasteColEnd < 0) return;

    const ordered: { name: string; equipment: string; startTime: string; endTime: string }[] = [];
    const map = new Map<string, { startTime: string; endTime: string }>();
    const pendingTemplates = templates.filter(t => !t.inputVideoUrl);
    let existingMatched = 0;

    for (const row of pasteDataRows) {
      const name = row[pasteColName]?.trim();
      const equipment = pasteColEquip >= 0 ? (row[pasteColEquip]?.trim() || '') : '';
      const start = row[pasteColStart]?.trim();
      const end = row[pasteColEnd]?.trim();
      if (!name) continue;

      ordered.push({ name, equipment, startTime: start || '0', endTime: end || '7' });

      // Also check if this matches an existing template (for backward compat)
      const norm = normalizeName(name);
      const template = pendingTemplates.find(t => normalizeName(t.exerciseName) === norm);
      if (template) {
        map.set(template.id, { startTime: start || '0', endTime: end || '7' });
        existingMatched++;
      }
    }

    setPastedTimings(map);
    setPastedOrder(ordered);
    setPasteResult({ matched: ordered.length, unmatched: 0 });

    // Auto-fill times on any already-assigned videos
    setVideos(prev => prev.map(v => {
      if (v.assignedTemplateId && map.has(v.assignedTemplateId)) {
        const timing = map.get(v.assignedTemplateId)!;
        return { ...v, startTime: timing.startTime, endTime: timing.endTime };
      }
      return v;
    }));
  }, [pasteDataRows, pasteColName, pasteColEquip, pasteColStart, pasteColEnd, templates]);

  // ── Assignment with auto-timing ───────────────────────────────────────────

  const handleAssignTemplate = useCallback((videoId: string, templateId: string | undefined) => {
    const updates: Partial<ImportedVideo> = { assignedTemplateId: templateId };
    if (templateId && pastedTimings.has(templateId)) {
      const timing = pastedTimings.get(templateId)!;
      updates.startTime = timing.startTime;
      updates.endTime = timing.endTime;
    }
    updateVideo(videoId, updates);
  }, [pastedTimings, updateVideo]);

  // ── Derived state ────────────────────────────────────────────────────────
  const allUploaded = videos.length > 0 && videos.every(v => v.status === 'uploaded' || v.status === 'failed');
  const uploadedVideos = videos.filter(v => v.status !== 'failed' && v.status !== 'uploading');

  // ── Auto-assign by order ─────────────────────────────────────────────────

  const handleAutoAssign = useCallback(() => {
    if (pastedOrder.length === 0 || uploadedVideos.length === 0) return;

    const pendingTemplates = templates.filter(t => !t.inputVideoUrl);

    setVideos(prev => {
      const uploaded = prev.filter(v => v.status !== 'failed' && v.status !== 'uploading');

      return prev.map(v => {
        if (v.status === 'failed' || v.status === 'uploading') return v;
        const idx = uploaded.indexOf(v);
        if (idx < 0 || idx >= pastedOrder.length) return v;
        const row = pastedOrder[idx];

        // Try to match an existing template by name
        const norm = normalizeName(row.name);
        const existingTemplate = pendingTemplates.find(t => normalizeName(t.exerciseName) === norm);

        return {
          ...v,
          assignedTemplateId: existingTemplate?.id,
          pastedExerciseName: row.name,
          pastedEquipment: row.equipment,
          startTime: row.startTime,
          endTime: row.endTime,
        };
      });
    });
  }, [pastedOrder, uploadedVideos, templates]);

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleFiles = useCallback(async (files: File[]) => {
    const videoFiles = files.filter(f => f.type.startsWith('video/'));
    if (videoFiles.length === 0) return;

    const newVideos: ImportedVideo[] = videoFiles.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: f.name,
      file: f,
      storageUrl: '',
      startTime: '0',
      endTime: '7',
      status: 'uploading' as const,
    }));

    setVideos(prev => [...prev, ...newVideos]);

    await Promise.all(newVideos.map(async (video, i) => {
      try {
        const file = videoFiles[i];
        const path = `uploads/${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage
          .from('videos')
          .upload(path, file, { contentType: file.type, upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('videos').getPublicUrl(path);
        setVideos(prev => prev.map(v => v.id === video.id
          ? { ...v, storageUrl: urlData.publicUrl, status: 'uploaded' as const }
          : v
        ));
      } catch (err) {
        setVideos(prev => prev.map(v => v.id === video.id
          ? { ...v, status: 'failed' as const, error: err instanceof Error ? err.message : 'Upload failed' }
          : v
        ));
      }
    }));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  }, [handleFiles]);

  const handleRemoveVideo = useCallback((id: string) => {
    setVideos(prev => prev.filter(v => v.id !== id));
  }, []);

  const handleContinueToTrim = useCallback(() => {
    if (uploadedVideos.length === 0) return;
    setPhase('trim');
  }, [uploadedVideos]);

  // ── Processing ────────────────────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    setPhase('processing');
    setSavedCount(0);

    const refPosition = generatePositions ? findReferencePosition(positions) : null;
    const toProcess = videos.filter(v => v.status === 'uploaded');
    let saved = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const video = toProcess[i];
      setProcessingIndex(i);

      try {
        const start = parseFloat(video.startTime) || 0;
        const end = parseFloat(video.endTime) || 7;

        setProcessingStep('Trimming');
        updateVideo(video.id, { status: 'trimming' });
        const blob = await trimVideo(video.storageUrl, start, end);
        const trimmedUrl = await uploadTrimmedVideo(blob);
        updateVideo(video.id, { trimmedUrl, status: 'trimmed' });

        let positionFile: File | undefined;
        if (refPosition) {
          setProcessingStep('Generating position');
          updateVideo(video.id, { status: 'generating' });
          try {
            positionFile = await autoGeneratePosition(trimmedUrl, refPosition.publicUrl, video.fileName);
            updateVideo(video.id, { positionFile, status: 'ready' });
          } catch (genErr) {
            console.error(`Position gen failed for ${video.fileName}:`, genErr);
            updateVideo(video.id, { status: 'ready' });
          }
        } else {
          updateVideo(video.id, { status: 'ready' });
        }

        // Save to existing template OR create new one from spreadsheet data
        if (video.assignedTemplateId || video.pastedExerciseName) {
          setProcessingStep('Saving');
          updateVideo(video.id, { status: 'saving' });

          let templateId = video.assignedTemplateId;
          let exerciseName = video.pastedExerciseName || '';
          let equipmentType = video.pastedEquipment || 'Bodyweight';

          // If assigned to existing template, use that
          if (templateId) {
            const template = templates.find(t => t.id === templateId);
            if (template) {
              exerciseName = template.exerciseName;
              equipmentType = template.equipmentType || equipmentType;
            }
          }

          // No existing template — create one from spreadsheet data
          if (!templateId && exerciseName) {
            try {
              const newTemplate = await onAddTemplate({
                exerciseName,
                equipmentType,
                inputVideoUrl: trimmedUrl,
                isTrimmed: true,
                positionId: '',
                positionName: '',
                customPrompt: '',
              });
              templateId = newTemplate.id;
            } catch (addErr) {
              console.error(`Failed to create template for ${exerciseName}:`, addErr);
            }
          }

          if (templateId) {
            const updates: Partial<ExerciseTemplate> = {
              inputVideoUrl: trimmedUrl,
              isTrimmed: true,
            };
            if (positionFile) {
              try {
                const position = await onCreatePosition(
                  exerciseName,
                  equipmentType,
                  positionFile
                );
                updates.positionId = position.id;
                updates.positionName = position.name;
              } catch (posErr) {
                console.error(`Position creation failed for ${exerciseName}:`, posErr);
              }
            }
            // Only update if we didn't just create it (onAddTemplate already set the URL)
            if (video.assignedTemplateId) {
              await onUpdateTemplate(templateId, updates);
            }
            saved++;
            setSavedCount(saved);
          }
          updateVideo(video.id, { status: 'ready' });
        }
      } catch (err) {
        console.error(`Processing failed for ${video.fileName}:`, err);
        updateVideo(video.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Processing failed',
        });
      }
    }

    setPhase('complete');
  }, [videos, positions, generatePositions, templates, updateVideo, onCreatePosition, onUpdateTemplate, onAddTemplate]);

  const handleClose = useCallback(() => {
    if (phase === 'processing') return;
    setPhase('upload');
    setVideos([]);
    setProcessingIndex(-1);
    setProcessingStep('');
    setSavedCount(0);
    setShowPaste(false);
    setPasteHeaders([]);
    setPasteDataRows([]);
    setPastedTimings(new Map());
    setPastedOrder([]);
    setPasteResult(null);
    setPasteColEquip(-1);
    onClose();
  }, [phase, onClose]);

  if (!isOpen) return null;

  const usedTemplateIds = new Set(videos.map(v => v.assignedTemplateId).filter(Boolean));

  const optionsForVideo = (videoId: string) => {
    const currentAssignment = videos.find(v => v.id === videoId)?.assignedTemplateId;
    return eligibleTemplates.filter(t =>
      !usedTemplateIds.has(t.id) || t.id === currentAssignment
    );
  };

  const canApplyPaste = pasteColName >= 0 && pasteColStart >= 0 && pasteColEnd >= 0;

  return (
    <div className="fixed inset-0 z-[100] bg-gray-900/95 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {phase === 'upload' ? 'Batch Import Videos' :
               phase === 'trim' ? 'Set Trim Times & Assign' :
               phase === 'processing' ? 'Processing…' :
               'Import Complete!'}
            </h2>
            {phase !== 'processing' && (
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* ─── PHASE: UPLOAD ─── */}
          {phase === 'upload' && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <svg className="mx-auto h-10 w-10 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm font-medium text-gray-700">Drag & drop video files here</p>
                <p className="text-xs text-gray-500 mt-1">or click to browse</p>
                <input ref={fileInputRef} type="file" accept="video/*" multiple onChange={handleFileInput} className="hidden" />
              </div>

              {videos.length > 0 && (
                <div className="mt-4 space-y-2">
                  {videos.map(v => (
                    <div key={v.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                      {v.status === 'uploading' ? (
                        <svg className="animate-spin h-4 w-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : v.status === 'failed' ? (
                        <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      <span className="text-sm text-gray-700 truncate flex-1">{v.fileName}</span>
                      {v.status !== 'uploading' && (
                        <button onClick={() => handleRemoveVideo(v.id)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {videos.length > 0 && (
                <button
                  onClick={handleContinueToTrim}
                  disabled={!allUploaded || uploadedVideos.length === 0}
                  className="mt-4 w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
                >
                  Continue ({uploadedVideos.length} video{uploadedVideos.length !== 1 ? 's' : ''})
                </button>
              )}
            </>
          )}

          {/* ─── PHASE: TRIM + ASSIGN ─── */}
          {phase === 'trim' && (
            <>
              {/* Paste from spreadsheet */}
              <div className="border border-gray-200 rounded-lg mb-5 overflow-hidden">
                <button
                  onClick={() => setShowPaste(p => !p)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Paste from spreadsheet
                    {pastedTimings.size > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        {pastedTimings.size} matched
                      </span>
                    )}
                  </div>
                  <svg className={`h-4 w-4 text-gray-400 transition-transform ${showPaste ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showPaste && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mt-3 mb-2">
                      Paste your spreadsheet rows (Cmd+V). Expected columns: exercise name, start time (seconds), end time (seconds).
                      Matched exercises will auto-fill their trim times.
                    </p>
                    <textarea
                      value={pasteText}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData('text');
                        setPasteText(text);
                        handlePasteText(text);
                        e.preventDefault();
                      }}
                      onChange={(e) => {
                        setPasteText(e.target.value);
                        if (e.target.value) handlePasteText(e.target.value);
                      }}
                      placeholder="Paste Excel/spreadsheet rows here…"
                      rows={3}
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
                    />

                    {pasteHeaders.length > 0 && (
                      <>
                        {/* Column mapping */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                          {[
                            { label: 'Exercise name', value: pasteColName, setter: setPasteColName },
                            { label: 'Equipment', value: pasteColEquip, setter: setPasteColEquip },
                            { label: 'Start time', value: pasteColStart, setter: setPasteColStart },
                            { label: 'End time', value: pasteColEnd, setter: setPasteColEnd },
                          ].map(({ label, value, setter }) => (
                            <div key={label}>
                              <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
                              <select
                                value={value}
                                onChange={e => setter(Number(e.target.value))}
                                className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                <option value={-1}>— Select column —</option>
                                {pasteHeaders.map((h, i) => (
                                  <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={handleApplyPaste}
                          disabled={!canApplyPaste}
                          className="mt-3 w-full px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-400 transition-colors"
                        >
                          Apply timings
                        </button>

                        {pasteResult && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-500">
                              <span className="text-green-700 font-medium">{pasteResult.matched} exercise{pasteResult.matched !== 1 ? 's' : ''} parsed</span>
                            </p>
                            {pastedOrder.length > 0 && uploadedVideos.length > 0 && (
                              <button
                                onClick={handleAutoAssign}
                                className="mt-2 w-full px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                              >
                                Auto-assign all by order ({Math.min(pastedOrder.length, uploadedVideos.length)} of {uploadedVideos.length} videos)
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Per-video cards */}
              <div className="space-y-4">
                {uploadedVideos.map(v => (
                  <div key={v.id} className="border border-gray-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-gray-800 mb-2 truncate">{v.fileName}</p>
                    {/* Video preview */}
                    <div className="flex justify-center mb-3">
                      <video
                        src={v.storageUrl}
                        controls
                        className="max-w-full max-h-44 rounded"
                        preload="metadata"
                      />
                    </div>
                    {/* Trim inputs */}
                    <div className="flex gap-3 mb-3">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Start (sec)</label>
                        <input
                          type="text"
                          value={v.startTime}
                          onChange={(e) => updateVideo(v.id, { startTime: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">End (sec)</label>
                        <input
                          type="text"
                          value={v.endTime}
                          onChange={(e) => updateVideo(v.id, { endTime: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {/* Exercise assignment */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Assign to exercise</label>
                      {v.pastedExerciseName && !v.assignedTemplateId ? (
                        <div className="flex items-center gap-2 px-2.5 py-2 text-sm border border-green-300 bg-green-50 rounded-md">
                          <svg className="h-4 w-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-green-800 font-medium truncate">{v.pastedExerciseName}</span>
                          {v.pastedEquipment && (
                            <span className="text-xs text-green-600 flex-shrink-0">{v.pastedEquipment}</span>
                          )}
                          <span className="text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded flex-shrink-0">new</span>
                          <button
                            type="button"
                            onClick={() => updateVideo(v.id, { pastedExerciseName: undefined, pastedEquipment: undefined })}
                            className="text-green-400 hover:text-red-500 flex-shrink-0 ml-auto"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <ExerciseSearchDropdown
                          videoId={v.id}
                          value={v.assignedTemplateId}
                          options={optionsForVideo(v.id)}
                          pastedTimings={pastedTimings}
                          onSelect={handleAssignTemplate}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer controls */}
              <div className="mt-5">
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className="text-sm text-gray-700">Generate position images</span>
                  <button
                    type="button"
                    onClick={() => setGeneratePositions(prev => !prev)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${generatePositions ? 'bg-blue-600' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${generatePositions ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <button
                  onClick={handleProcess}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {generatePositions
                    ? `Batch Trim & Generate Positions (${uploadedVideos.length})`
                    : `Batch Trim (${uploadedVideos.length})`}
                </button>
              </div>
            </>
          )}

          {/* ─── PHASE: PROCESSING ─── */}
          {phase === 'processing' && (
            <div className="text-center py-8">
              <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-lg font-medium text-gray-900">
                {processingStep} {processingIndex + 1} of {videos.filter(v => v.status !== 'failed').length}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {videos[processingIndex]?.fileName || ''}
              </p>

              <div className="mt-6 text-left space-y-1">
                {videos.filter(v => v.status !== 'failed' || v.trimmedUrl).map(v => (
                  <div key={v.id} className="flex items-center gap-2 px-3 py-1.5">
                    {v.status === 'trimming' || v.status === 'generating' || v.status === 'saving' ? (
                      <svg className="animate-spin h-3.5 w-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : v.status === 'ready' || v.status === 'trimmed' ? (
                      <svg className="h-3.5 w-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full bg-gray-200 flex-shrink-0" />
                    )}
                    <span className={`text-sm truncate ${
                      v.status === 'trimming' || v.status === 'generating' || v.status === 'saving' ? 'text-blue-600 font-medium' :
                      v.status === 'ready' ? 'text-green-600' : 'text-gray-500'
                    }`}>
                      {v.fileName}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-xs text-gray-400">Keep this window open until processing finishes.</p>
            </div>
          )}

          {/* ─── PHASE: COMPLETE ─── */}
          {phase === 'complete' && (
            <div className="text-center py-8">
              <svg className="mx-auto h-12 w-12 text-green-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg font-semibold text-gray-900 mb-1">Done</p>
              <p className="text-sm text-gray-500">
                {savedCount > 0
                  ? `${savedCount} video${savedCount !== 1 ? 's' : ''} trimmed and saved to exercises.`
                  : `${videos.filter(v => v.status === 'ready').length} video${videos.filter(v => v.status === 'ready').length !== 1 ? 's' : ''} trimmed (none assigned).`}
              </p>
              <button
                onClick={handleClose}
                className="mt-6 px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
