'use client';

import { useState, useRef, useCallback } from 'react';
import { parseTemplateData, ParseResult } from '@/lib/parseExcelTemplates';
import { trimVideo } from '@/lib/videoTrimmer';
import { downloadVideo, uploadTrimmedVideo } from '@/lib/videoDownload';
import { autoGeneratePosition, findReferencePosition } from '@/lib/positionGenerator';
import type { Position, ExerciseTemplate } from '@/types';


interface ImportTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (templates: Omit<ExerciseTemplate, 'id' | 'createdAt'>[]) => Promise<void>;
  positions: Position[];
  equipmentNames: string[];
  createPosition?: (name: string, equipmentType: string, imageFile: File) => Promise<Position>;
  templates?: ExerciseTemplate[];
  onUpdateTemplate?: (id: string, updates: Partial<ExerciseTemplate>) => Promise<void>;
}

type TopTab = 'templates' | 'photos';
type Phase = 'input' | 'downloading' | 'results' | 'trimming' | 'generating' | 'importing' | 'complete';

interface DownloadResult {
  index: number;
  exerciseName: string;
  youtubeUrl: string;
  blobUrl?: string;
  error?: string;
  status: 'pending' | 'downloading' | 'done' | 'failed';
}

interface PhotoMatch {
  id: string;
  fileName: string;
  file: File;
  matchedTemplateId?: string;
  matchedTemplateName?: string;
  equipmentType?: string;
  status: 'matched' | 'unmatched';
}

type PhotoPhase = 'idle' | 'importing' | 'complete';

async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onDone: (index: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
      onDone(i);
    }
  }

  const workers = Array(Math.min(limit, tasks.length))
    .fill(null)
    .map(() => runNext());
  await Promise.all(workers);
  return results;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchPhotosToTemplates(files: File[], allTemplates: ExerciseTemplate[]): PhotoMatch[] {
  const imageExts = /\.(png|jpe?g)$/i;
  return files.filter(f => f.type.startsWith('image/') || imageExts.test(f.name)).map(f => {
    const baseName = f.name.replace(imageExts, '').trim();
    const norm = normalizeName(baseName);
    const match = allTemplates.find(t => normalizeName(t.exerciseName) === norm);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: f.name,
      file: f,
      matchedTemplateId: match?.id,
      matchedTemplateName: match?.exerciseName,
      equipmentType: match?.equipmentType,
      status: match ? 'matched' : 'unmatched',
    };
  });
}

export default function ImportTemplatesModal({
  isOpen,
  onClose,
  onImport,
  positions,
  equipmentNames,
  createPosition,
  templates = [],
  onUpdateTemplate,
}: ImportTemplatesModalProps) {
  const [topTab, setTopTab] = useState<TopTab>('templates');

  // ── Templates tab state ──────────────────────────────────────────────────
  const [pasteText, setPasteText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [generatePositions, setGeneratePositions] = useState(false);

  const [phase, setPhase] = useState<Phase>('input');
  const [downloadResults, setDownloadResults] = useState<DownloadResult[]>([]);
  const [downloadProgress, setDownloadProgress] = useState({ completed: 0, total: 0 });
  const [trimProgress, setTrimProgress] = useState({ completed: 0, total: 0, currentName: '' });
  const [genProgress, setGenProgress] = useState({ completed: 0, total: 0, currentName: '' });

  // ── Photos tab state ─────────────────────────────────────────────────────
  const [photos, setPhotos] = useState<PhotoMatch[]>([]);
  const [isPhotosDragging, setIsPhotosDragging] = useState(false);
  const [photoPhase, setPhotoPhase] = useState<PhotoPhase>('idle');
  const [photoProgress, setPhotoProgress] = useState({ completed: 0, total: 0 });
  const [photosSaved, setPhotosSaved] = useState(0);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setPasteText('');
    setParseResult(null);
    setPhase('input');
    setDownloadResults([]);
    setDownloadProgress({ completed: 0, total: 0 });
    setTrimProgress({ completed: 0, total: 0, currentName: '' });
    setGenProgress({ completed: 0, total: 0, currentName: '' });
    setPhotos([]);
    setPhotoPhase('idle');
    setPhotoProgress({ completed: 0, total: 0 });
    setPhotosSaved(0);
  }, []);

  const isBusy = phase === 'downloading' || phase === 'trimming' || phase === 'generating' || photoPhase === 'importing';

  const handleClose = useCallback(() => {
    if (isBusy) return;
    resetState();
    onClose();
  }, [onClose, resetState, isBusy]);

  // ── Templates tab handlers ───────────────────────────────────────────────

  const handleParse = useCallback((input: ArrayBuffer | string) => {
    const result = parseTemplateData(input, positions, equipmentNames);
    setParseResult(result);
    setPhase('input');
  }, [positions, equipmentNames]);

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setPasteText(text);
    if (text.trim()) {
      handleParse(text);
    } else {
      setParseResult(null);
    }
  };

  const handleStartImport = async () => {
    if (!parseResult || parseResult.templates.length === 0) return;

    const youtubeTemplates = parseResult.templates
      .map((t, i) => ({ index: i, exerciseName: t.exerciseName, youtubeUrl: t.youtubeUrl }))
      .filter((t) => t.youtubeUrl);

    if (youtubeTemplates.length === 0) {
      setPhase('importing');
      setImporting(true);
      try {
        await onImport(parseResult.templates);
        setPhase('complete');
      } finally {
        setImporting(false);
      }
      return;
    }

    const initialResults: DownloadResult[] = youtubeTemplates.map((t) => ({
      index: t.index,
      exerciseName: t.exerciseName,
      youtubeUrl: t.youtubeUrl!,
      status: 'pending',
    }));
    setDownloadResults(initialResults);
    setDownloadProgress({ completed: 0, total: youtubeTemplates.length });
    setPhase('downloading');

    const tasks = youtubeTemplates.map((t, taskIdx) => async () => {
      setDownloadResults((prev) =>
        prev.map((r, i) => (i === taskIdx ? { ...r, status: 'downloading' as const } : r))
      );
      try {
        const blobUrl = await downloadVideo(t.youtubeUrl!);
        setDownloadResults((prev) =>
          prev.map((r, i) => (i === taskIdx ? { ...r, status: 'done' as const, blobUrl } : r))
        );
        return { blobUrl, error: undefined };
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Download failed';
        setDownloadResults((prev) =>
          prev.map((r, i) => (i === taskIdx ? { ...r, status: 'failed' as const, error } : r))
        );
        return { blobUrl: undefined, error };
      }
    });

    await runConcurrent(tasks, 1, () => {
      setDownloadProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
    });

    setPhase('results');
  };

  const handleFinishImport = async () => {
    if (!parseResult) return;

    const enrichedTemplates = parseResult.templates.map((t, i) => {
      const dl = downloadResults.find((d) => d.index === i);
      if (dl?.blobUrl) {
        return { ...t, inputVideoUrl: dl.blobUrl, youtubeUrl: undefined };
      }
      return t;
    });

    const trimCandidates = enrichedTemplates
      .map((t, i) => ({ template: t, index: i }))
      .filter(({ template }) =>
        template.inputVideoUrl &&
        template.startTime !== undefined &&
        template.endTime !== undefined &&
        template.startTime < template.endTime
      );

    if (trimCandidates.length > 0) {
      setPhase('trimming');
      setTrimProgress({ completed: 0, total: trimCandidates.length, currentName: trimCandidates[0].template.exerciseName });

      for (const { template, index } of trimCandidates) {
        setTrimProgress((prev) => ({ ...prev, currentName: template.exerciseName }));
        try {
          const trimmedBlob = await trimVideo(template.inputVideoUrl!, template.startTime!, template.endTime!);
          const trimmedUrl = await uploadTrimmedVideo(trimmedBlob);
          enrichedTemplates[index] = { ...enrichedTemplates[index], inputVideoUrl: trimmedUrl, isTrimmed: true };
        } catch (err) {
          console.error(`Failed to trim ${template.exerciseName}:`, err);
        }
        setTrimProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      }
    }

    if (createPosition && generatePositions) {
      const genCandidates = enrichedTemplates.filter(t => t.inputVideoUrl && !t.positionId);
      const standingPosition = findReferencePosition(positions);

      if (genCandidates.length > 0 && standingPosition) {
        setPhase('generating');
        setGenProgress({ completed: 0, total: genCandidates.length, currentName: genCandidates[0].exerciseName });

        const genTasks = genCandidates.map((template) => async () => {
          setGenProgress(prev => ({ ...prev, currentName: template.exerciseName }));
          try {
            const positionFile = await autoGeneratePosition(
              template.inputVideoUrl!,
              standingPosition.publicUrl,
              template.exerciseName,
            );
            const position = await createPosition(
              template.exerciseName,
              template.equipmentType || 'Bodyweight',
              positionFile
            );
            template.positionId = position.id;
            template.positionName = position.name;
          } catch (err) {
            console.error(`[Import] Position gen failed for ${template.exerciseName}:`, err);
          }
        });

        await runConcurrent(genTasks, 3, () => {
          setGenProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
        });
      }
    }

    setPhase('importing');
    setImporting(true);
    try {
      await onImport(enrichedTemplates);
      setPhase('complete');
    } finally {
      setImporting(false);
    }
  };

  // ── Photos tab handlers ──────────────────────────────────────────────────

  const handlePhotoFiles = useCallback((files: File[]) => {
    const matches = matchPhotosToTemplates(files, templates);
    if (matches.length === 0) return;
    setPhotos(prev => {
      // Avoid duplicates by fileName
      const existingNames = new Set(prev.map(p => p.fileName));
      return [...prev, ...matches.filter(m => !existingNames.has(m.fileName))];
    });
  }, [templates]);

  const handlePhotosDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsPhotosDragging(false);
    handlePhotoFiles(Array.from(e.dataTransfer.files));
  }, [handlePhotoFiles]);

  const handlePhotosInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handlePhotoFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  }, [handlePhotoFiles]);

  const handleImportPhotos = async () => {
    const matched = photos.filter(p => p.status === 'matched');
    if (matched.length === 0 || !createPosition || !onUpdateTemplate) return;

    setPhotoPhase('importing');
    setPhotoProgress({ completed: 0, total: matched.length });
    let saved = 0;

    for (const photo of matched) {
      try {
        const template = templates.find(t => t.id === photo.matchedTemplateId);
        if (!template) continue;

        const position = await createPosition(
          template.exerciseName,
          template.equipmentType || 'Bodyweight',
          photo.file,
        );
        await onUpdateTemplate(template.id, {
          positionId: position.id,
          positionName: position.name,
        });
        saved++;
      } catch (err) {
        console.error(`Failed to import position for ${photo.matchedTemplateName}:`, err);
      }
      setPhotoProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
    }

    setPhotosSaved(saved);
    setPhotoPhase('complete');
  };

  if (!isOpen) return null;

  const hasTemplates = parseResult && parseResult.templates.length > 0;
  const hasErrors = parseResult && parseResult.errors.length > 0;
  const successCount = downloadResults.filter((r) => r.status === 'done').length;
  const failCount = downloadResults.filter((r) => r.status === 'failed').length;

  const matchedPhotos = photos.filter(p => p.status === 'matched');
  const unmatchedPhotos = photos.filter(p => p.status === 'unmatched');

  const showTopTabs = !isBusy && phase === 'input' && photoPhase === 'idle';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {phase === 'downloading' ? 'Downloading Videos…' :
             phase === 'trimming' ? 'Trimming Videos…' :
             phase === 'generating' ? 'Generating Positions…' :
             phase === 'results' ? 'Download Results' :
             phase === 'complete' ? 'Import Complete' :
             photoPhase === 'importing' ? 'Importing Photos…' :
             photoPhase === 'complete' ? 'Photos Imported' :
             'Import'}
          </h2>
          {!isBusy && (
            <button
              onClick={handleClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Top-level tabs */}
        {showTopTabs && (
          <div className="flex border-b flex-shrink-0">
            <button
              onClick={() => setTopTab('templates')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                topTab === 'templates' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Import Templates
            </button>
            <button
              onClick={() => setTopTab('photos')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                topTab === 'photos' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Import Position Photos
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ══ TEMPLATES TAB ════════════════════════════════════════════ */}
          {(topTab === 'templates' || !showTopTabs) && (
            <>
              {/* ── DOWNLOADING ── */}
              {phase === 'downloading' && (
                <div className="space-y-4">
                  <div className="text-center mb-4">
                    <p className="text-sm text-gray-600">
                      Downloading {downloadProgress.completed} of {downloadProgress.total} videos...
                    </p>
                    <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${downloadProgress.total > 0 ? (downloadProgress.completed / downloadProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1.5">
                    {downloadResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 text-sm">
                        {r.status === 'pending' && <span className="h-4 w-4 rounded-full bg-gray-300 flex-shrink-0" />}
                        {r.status === 'downloading' && (
                          <svg className="h-4 w-4 animate-spin text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        )}
                        {r.status === 'done' && (
                          <svg className="h-4 w-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {r.status === 'failed' && (
                          <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        <span className="truncate text-gray-700">{r.exerciseName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── TRIMMING ── */}
              {phase === 'trimming' && (
                <div className="text-center mb-4">
                  <p className="text-sm text-gray-600">
                    Trimming {trimProgress.completed} of {trimProgress.total} videos...
                  </p>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${trimProgress.total > 0 ? (trimProgress.completed / trimProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  {trimProgress.currentName && (
                    <p className="mt-2 text-xs text-gray-500 truncate">Currently trimming: {trimProgress.currentName}</p>
                  )}
                </div>
              )}

              {/* ── GENERATING ── */}
              {phase === 'generating' && (
                <div className="text-center mb-4">
                  <p className="text-sm text-gray-600">
                    Generating position {genProgress.completed + 1} of {genProgress.total}...
                  </p>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${genProgress.total > 0 ? (genProgress.completed / genProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  {genProgress.currentName && (
                    <p className="mt-2 text-xs text-gray-500 truncate">{genProgress.currentName}</p>
                  )}
                  <p className="mt-3 text-xs text-gray-400">Extracting frame, generating with Gemini, framing on canvas...</p>
                </div>
              )}

              {/* ── RESULTS ── */}
              {phase === 'results' && (
                <div className="space-y-4">
                  <div className="flex gap-3 justify-center">
                    {successCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {successCount} downloaded
                      </span>
                    )}
                    {failCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {failCount} failed
                      </span>
                    )}
                  </div>
                  {failCount > 0 && (
                    <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-red-800">Failed downloads</p>
                        <button
                          onClick={() => {
                            const urls = downloadResults.filter(r => r.status === 'failed').map(r => r.youtubeUrl);
                            for (const url of urls) window.open(url, '_blank');
                          }}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Open all ({failCount})
                        </button>
                      </div>
                      <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                        {downloadResults.filter((r) => r.status === 'failed').map((r, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <a href={r.youtubeUrl} target="_blank" rel="noopener noreferrer"
                              className="truncate text-blue-600 hover:text-blue-800 hover:underline flex-1">
                              {r.exerciseName}
                            </a>
                            <svg className="h-3 w-3 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-sm text-gray-600 text-center">
                    All {parseResult?.templates.length} templates will be imported.
                    {failCount > 0 && ` Failed downloads will keep their YouTube link.`}
                  </p>
                </div>
              )}

              {/* ── IMPORTING ── */}
              {phase === 'importing' && (
                <div className="text-center py-8">
                  <svg className="mx-auto h-8 w-8 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="mt-3 text-sm text-gray-600">Importing templates...</p>
                </div>
              )}

              {/* ── COMPLETE ── */}
              {phase === 'complete' && (
                <div className="text-center py-8">
                  <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Import Complete</h3>
                  <p className="text-gray-600 mb-4">
                    Successfully imported {parseResult?.templates.length} template{parseResult?.templates.length !== 1 ? 's' : ''}.
                    {successCount > 0 && ` ${successCount} video${successCount !== 1 ? 's' : ''} pre-downloaded.`}
                  </p>
                  <button onClick={handleClose} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Done
                  </button>
                </div>
              )}

              {/* ── INPUT ── */}
              {phase === 'input' && topTab === 'templates' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Paste your data</label>
                    <p className="text-xs text-gray-500 mb-2">Copy rows from Excel, Google Sheets, or any spreadsheet. Include the header row.</p>
                    <textarea
                      value={pasteText}
                      onChange={handlePasteChange}
                      placeholder={`NAME\tEQUIPMENT\tLINK\nBicep Curl\tDumbbell\thttps://youtu.be/...\nSquat\tBarbell\thttps://youtu.be/...`}
                      className="w-full h-40 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs font-medium text-gray-700 mb-1">Recognized column names:</p>
                    <p className="text-xs text-gray-500">Name, Equipment, Position/Avatar/Photo, Link/URL/Video, Start, End, Force, Mechanic, Limbs, Body, Difficulty, Muscles</p>
                  </div>

                  {parseResult && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {parseResult.recognizedColumns.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {parseResult.recognizedColumns.map((col) => (
                              <span key={col} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{col}</span>
                            ))}
                          </div>
                        )}
                        {parseResult.unrecognizedColumns.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {parseResult.unrecognizedColumns.map((col) => (
                              <span key={col} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 line-through">{col}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      {hasTemplates && (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-gray-50 px-3 py-2 border-b">
                            <p className="text-sm font-medium text-gray-700">
                              Preview ({parseResult.templates.length} template{parseResult.templates.length !== 1 ? 's' : ''})
                            </p>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                  <th className="px-2 py-1.5 text-left font-medium text-gray-600">Name</th>
                                  <th className="px-2 py-1.5 text-left font-medium text-gray-600">Equipment</th>
                                  <th className="px-2 py-1.5 text-left font-medium text-gray-600">Position</th>
                                  <th className="px-2 py-1.5 text-left font-medium text-gray-600">Link</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {parseResult.templates.slice(0, 20).map((t, i) => (
                                  <tr key={i} className="hover:bg-gray-50">
                                    <td className="px-2 py-1.5 text-gray-900 truncate max-w-[150px]">{t.exerciseName}</td>
                                    <td className="px-2 py-1.5 text-gray-600">{t.equipmentType || <span className="text-gray-300">—</span>}</td>
                                    <td className="px-2 py-1.5 text-gray-600">{t.positionName || <span className="text-gray-300">—</span>}</td>
                                    <td className="px-2 py-1.5 text-gray-600 truncate max-w-[120px]">
                                      {t.youtubeUrl ? (
                                        <span className="text-blue-600">{t.youtubeUrl.replace(/https?:\/\/(www\.)?/, '').slice(0, 20)}...</span>
                                      ) : (
                                        <span className="text-gray-300">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {parseResult.templates.length > 20 && (
                                  <tr>
                                    <td colSpan={4} className="px-2 py-1.5 text-center text-gray-400 italic">
                                      + {parseResult.templates.length - 20} more...
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {hasErrors && (
                        <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-3">
                          <p className="text-xs font-medium text-yellow-800 mb-1">Warnings ({parseResult.errors.length})</p>
                          <ul className="text-xs text-yellow-700 space-y-0.5 max-h-24 overflow-y-auto">
                            {parseResult.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ══ PHOTOS TAB ═══════════════════════════════════════════════ */}
          {topTab === 'photos' && showTopTabs && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Drop image files (PNG, JPG) named after exercises (e.g. <span className="font-mono bg-gray-100 px-1 rounded text-xs">Squat.png</span>).
                Each file will be matched to a template with that exact name and uploaded as its position photo.
              </p>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsPhotosDragging(true); }}
                onDragLeave={() => setIsPhotosDragging(false)}
                onDrop={handlePhotosDrop}
                onClick={() => photoInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isPhotosDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <svg className="mx-auto h-10 w-10 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm font-medium text-gray-700">Drag & drop image files here</p>
                <p className="text-xs text-gray-500 mt-1">or click to browse — multiple files supported</p>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                  multiple
                  onChange={handlePhotosInputChange}
                  className="hidden"
                />
              </div>

              {/* Results list */}
              {photos.length > 0 && (
                <div className="space-y-3">
                  {matchedPhotos.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1.5">
                        Matched ({matchedPhotos.length})
                      </p>
                      <div className="space-y-1">
                        {matchedPhotos.map(p => (
                          <div key={p.id} className="flex items-center gap-2.5 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                            <svg className="h-4 w-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{p.matchedTemplateName}</p>
                              <p className="text-xs text-gray-500 truncate">{p.fileName}{p.equipmentType ? ` · ${p.equipmentType}` : ''}</p>
                            </div>
                            <button
                              onClick={() => setPhotos(prev => prev.filter(x => x.id !== p.id))}
                              className="text-gray-400 hover:text-red-500 flex-shrink-0"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {unmatchedPhotos.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1.5">
                        No match found ({unmatchedPhotos.length})
                      </p>
                      <div className="space-y-1">
                        {unmatchedPhotos.map(p => (
                          <div key={p.id} className="flex items-center gap-2.5 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-sm text-gray-500 truncate flex-1">{p.fileName}</span>
                            <button
                              onClick={() => setPhotos(prev => prev.filter(x => x.id !== p.id))}
                              className="text-gray-400 hover:text-red-500 flex-shrink-0"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── PHOTOS IMPORTING ── */}
          {photoPhase === 'importing' && (
            <div className="text-center py-8">
              <svg className="mx-auto h-8 w-8 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="mt-3 text-sm text-gray-600">
                Uploading {photoProgress.completed} of {photoProgress.total} photos…
              </p>
            </div>
          )}

          {/* ── PHOTOS COMPLETE ── */}
          {photoPhase === 'complete' && (
            <div className="text-center py-8">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Done</h3>
              <p className="text-gray-600 mb-4">
                {photosSaved} position photo{photosSaved !== 1 ? 's' : ''} uploaded and linked.
              </p>
              <button onClick={handleClose} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === 'input' && topTab === 'templates' && (
          <div className="border-t px-5 py-4 space-y-3 flex-shrink-0">
            {hasTemplates && createPosition && (
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-gray-700">Generate position images</span>
                <button
                  type="button"
                  onClick={() => setGeneratePositions(prev => !prev)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${generatePositions ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${generatePositions ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </label>
            )}
            <div className="flex gap-3">
              <button onClick={handleClose} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                Cancel
              </button>
              <button
                onClick={handleStartImport}
                disabled={!hasTemplates || importing}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
              >
                {`Import ${parseResult?.templates.length || 0} Templates`}
              </button>
            </div>
          </div>
        )}

        {phase === 'results' && (
          <div className="border-t px-5 py-4 flex gap-3 flex-shrink-0">
            <button
              onClick={handleFinishImport}
              disabled={importing}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
            >
              {importing ? 'Importing...' : `Continue Import (${parseResult?.templates.length} templates)`}
            </button>
          </div>
        )}

        {topTab === 'photos' && photoPhase === 'idle' && matchedPhotos.length > 0 && (
          <div className="border-t px-5 py-4 flex-shrink-0">
            <button
              onClick={handleImportPhotos}
              disabled={!createPosition || !onUpdateTemplate}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
            >
              Import {matchedPhotos.length} Position Photo{matchedPhotos.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
