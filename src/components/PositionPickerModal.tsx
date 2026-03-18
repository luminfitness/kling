'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ExerciseTemplate, Position } from '@/types';
import { extractFrames, type ExtractedFrame, type ExtractionProgress } from '@/lib/frameExtractor';
import { getPromptHistory, savePromptToHistory, deletePromptFromHistory, clearPromptHistory } from '@/lib/promptHistory';

interface PositionPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  positions: Position[];
  equipmentOptions: string[];
  selectedTemplate: ExerciseTemplate | null;
  onPositionSelect: (positionId: string, positionName: string) => void;
  onRemovePosition?: () => void;
  onCreatePosition?: (name: string, equipmentType: string, imageFile: File) => Promise<Position>;
  defaultEquipFilter: string;
}

type Page = 'pick' | 'generate';

export default function PositionPickerModal({
  isOpen,
  onClose,
  positions,
  equipmentOptions,
  selectedTemplate,
  onPositionSelect,
  onRemovePosition,
  onCreatePosition,
  defaultEquipFilter,
}: PositionPickerModalProps) {
  const [page, setPage] = useState<Page>('pick');
  const [equipFilter, setEquipFilter] = useState(defaultEquipFilter);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Video frames state
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [framesProgress, setFramesProgress] = useState<ExtractionProgress | null>(null);

  // Generate page state
  const [images, setImages] = useState<string[]>([]); // up to 3 reference images
  const [prompt, setPrompt] = useState('Make the character in the 1st reference image be in the pose of the second photo and holding the equipment in the same way. Keep the original background of 1st reference image.');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isSavingGenerated, setIsSavingGenerated] = useState(false);
  const [showPositionGrid, setShowPositionGrid] = useState(false);
  const [genEquipFilter, setGenEquipFilter] = useState('All');
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [showPositionPicker, setShowPositionPicker] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadPositionRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [isUploadingPosition, setIsUploadingPosition] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPage('pick');
      setEquipFilter(defaultEquipFilter);
      setPreviewImageUrl(null);
      setImages([]);
      setGeneratedImageUrl(null);
      setPrompt('Make the character in the 1st reference image be in the pose of the second photo and holding the equipment in the same way. Keep the original background of 1st reference image.');
      setShowPositionGrid(false);
      setShowPositionPicker(false);
      setPromptHistory(getPromptHistory());
      setShowHistoryDropdown(false);
    }
  }, [isOpen, defaultEquipFilter]);

  // Close history dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Extract frames when modal opens with a template that has a downloaded video
  useEffect(() => {
    if (!isOpen || !selectedTemplate?.inputVideoUrl) {
      setFrames([]);
      setFramesLoading(false);
      setFramesProgress(null);
      return;
    }

    let cancelled = false;
    setFramesLoading(true);
    setFrames([]);

    extractFrames(
      selectedTemplate.inputVideoUrl,
      1.0,
      20,
      (progress) => { if (!cancelled) setFramesProgress(progress); }
    )
      .then((extracted) => { if (!cancelled) { setFrames(extracted); setFramesLoading(false); } })
      .catch((err) => {
        console.error('Frame extraction failed:', err);
        if (!cancelled) { setFrames([]); setFramesLoading(false); }
      });

    return () => { cancelled = true; };
  }, [isOpen, selectedTemplate?.inputVideoUrl]);

  // Image helpers
  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1024;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = (h / w) * MAX; w = MAX; }
            else { w = (w / h) * MAX; h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const addImageFromUrl = useCallback((publicUrl: string) => {
    if (images.length >= 3) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = (h / w) * MAX; w = MAX; }
        else { w = (w / h) * MAX; h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setImages(prev => [...prev, dataUrl].slice(0, 3));
      setShowPositionGrid(false);
      setGeneratedImageUrl(null);
    };
    img.src = publicUrl;
  }, [images.length]);

  const addImageFromDataUrl = useCallback((dataUrl: string) => {
    if (images.length >= 3) return;
    setImages(prev => [...prev, dataUrl].slice(0, 3));
    setGeneratedImageUrl(null);
  }, [images.length]);

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setGeneratedImageUrl(null);
  };

  const handleUploadCustomPosition = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onCreatePosition || !selectedTemplate) return;
    setIsUploadingPosition(true);
    try {
      const newPosition = await onCreatePosition(
        selectedTemplate.exerciseName || 'Custom Position',
        selectedTemplate.equipmentType || 'Other',
        file
      );
      onPositionSelect(newPosition.id, newPosition.name);
      setShowPositionPicker(false);
    } catch (err) {
      console.error('Upload custom position failed:', err);
      alert('Failed to upload position image');
    } finally {
      setIsUploadingPosition(false);
      if (uploadPositionRef.current) uploadPositionRef.current.value = '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 3 - images.length;
    const filesToProcess = Array.from(files).slice(0, remaining);
    for (const file of filesToProcess) {
      const resized = await resizeImage(file);
      setImages(prev => [...prev, resized].slice(0, 3));
    }
    setGeneratedImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = useCallback(async () => {
    if (images.length === 0) return;
    setIsGenerating(true);
    setGeneratedImageUrl(null);

    try {
      // Save prompt to history
      if (prompt.trim()) {
        savePromptToHistory(prompt.trim());
        setPromptHistory(getPromptHistory());
      }

      const response = await fetch('/api/generate-position-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImage1: images[0],
          referenceImage2: images[1] || null,
          prompt,
        }),
      });

      const data = await response.json();
      if (data.imageUrl) {
        setGeneratedImageUrl(data.imageUrl);
      } else {
        alert(data.error || 'Failed to generate image');
      }
    } catch (err) {
      console.error('Generate failed:', err);
      alert('Failed to generate image');
    } finally {
      setIsGenerating(false);
    }
  }, [images, prompt]);

  const handleUseGeneratedImage = useCallback(async () => {
    if (!generatedImageUrl || !onCreatePosition || !selectedTemplate) return;
    setIsSavingGenerated(true);

    try {
      const res = await fetch(generatedImageUrl);
      const blob = await res.blob();
      const file = new File([blob], `${selectedTemplate.exerciseName || 'generated'}-position.png`, {
        type: blob.type || 'image/png',
      });

      const newPosition = await onCreatePosition(
        selectedTemplate.exerciseName || 'Generated Position',
        selectedTemplate.equipmentType || 'Other',
        file
      );

      onPositionSelect(newPosition.id, newPosition.name);
      onClose();
    } catch (err) {
      console.error('Save generated position failed:', err);
      alert('Failed to save generated position');
    } finally {
      setIsSavingGenerated(false);
    }
  }, [generatedImageUrl, onCreatePosition, selectedTemplate, onPositionSelect, onClose]);

  if (!isOpen) return null;

  const filtered = positions.filter(
    (p) => equipFilter === 'All' || p.equipmentType === equipFilter
  );
  const genFiltered = positions.filter(
    (p) => genEquipFilter === 'All' || p.equipmentType === genEquipFilter
  );
  const hasVideo = !!selectedTemplate?.inputVideoUrl;
  const currentPosition = selectedTemplate?.positionId
    ? positions.find(p => p.id === selectedTemplate.positionId)
    : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-4xl mx-4 rounded-lg bg-white overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            {page === 'generate' && (
              <button
                onClick={() => setPage('pick')}
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h3 className="text-lg font-semibold">
              {page === 'pick' ? 'Position' : 'Generate Position'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ===================== PAGE 1: PICK ===================== */}
        {page === 'pick' && (
          <>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* Current Position + Video Frames — side by side */}
              <div className="px-4 py-4 border-b">
                <div className="flex gap-4">
                  {/* Left: Current Position */}
                  <div className="flex-shrink-0">
                    {currentPosition ? (
                      <div>
                        <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-1.5">Current</p>
                        <img
                          src={currentPosition.publicUrl}
                          alt={currentPosition.name}
                          className="h-44 w-auto rounded-lg border-2 border-blue-400 object-cover cursor-pointer shadow-sm"
                          onClick={() => setPreviewImageUrl(currentPosition.publicUrl)}
                        />
                        <p className="text-sm font-medium text-gray-900 mt-1.5 truncate max-w-[140px]">{currentPosition.name}</p>
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => setShowPositionPicker(!showPositionPicker)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-lg shadow-sm hover:shadow transition-all"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                            Swap
                          </button>
                          {onCreatePosition && (
                            <>
                              <button
                                onClick={() => uploadPositionRef.current?.click()}
                                disabled={isUploadingPosition}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                {isUploadingPosition ? 'Uploading...' : 'Upload'}
                              </button>
                              <input
                                ref={uploadPositionRef}
                                type="file"
                                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                                onChange={handleUploadCustomPosition}
                                className="hidden"
                              />
                              <button
                                onClick={() => {
                                  if (currentPosition.publicUrl) {
                                    addImageFromUrl(currentPosition.publicUrl);
                                  }
                                  setPage('generate');
                                }}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 rounded-lg shadow-sm hover:shadow transition-all"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                Regenerate
                              </button>
                            </>
                          )}
                          {onRemovePosition && (
                            <button
                              onClick={() => { onRemovePosition(); onClose(); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-lg shadow-sm hover:shadow transition-all"
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              Remove
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(currentPosition.publicUrl);
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `${currentPosition.name}.png`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                              } catch (err) {
                                console.error('Download failed:', err);
                              }
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 rounded-lg shadow-sm hover:shadow transition-all"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Position</p>
                        <div className="h-44 w-[110px] rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center">
                          <svg className="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => setShowPositionPicker(true)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 rounded-lg shadow-sm hover:shadow transition-all"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            Select
                          </button>
                          {onCreatePosition && (
                            <>
                              <button
                                onClick={() => uploadPositionRef.current?.click()}
                                disabled={isUploadingPosition}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                {isUploadingPosition ? 'Uploading...' : 'Upload'}
                              </button>
                              <input
                                ref={uploadPositionRef}
                                type="file"
                                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                                onChange={handleUploadCustomPosition}
                                className="hidden"
                              />
                              <button
                                onClick={() => setPage('generate')}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 rounded-lg shadow-sm hover:shadow transition-all"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                Generate
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Video Frames */}
                  {hasVideo && (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Video Frames</p>
                        <span className="text-xs text-gray-400">Click to preview</span>
                      </div>

                      {framesLoading ? (
                        <div className="flex items-center gap-2 py-12 justify-center">
                          <svg className="h-5 w-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span className="text-sm text-gray-500">
                            {framesProgress
                              ? `Extracting frame ${framesProgress.current} of ${framesProgress.total}...`
                              : 'Loading video...'}
                          </span>
                        </div>
                      ) : frames.length > 0 ? (
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                          {frames.map((frame, i) => (
                            <div
                              key={i}
                              onClick={() => setPreviewImageUrl(frame.dataUrl)}
                              className="flex-shrink-0 cursor-pointer rounded-lg overflow-hidden hover:ring-2 hover:ring-gray-300 transition-all"
                            >
                              <img
                                src={frame.dataUrl}
                                alt={`Frame ${i + 1}`}
                                className="h-44 w-auto object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 py-2">Could not extract frames from video.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Positions Grid - expandable */}
              {(showPositionPicker || !currentPosition) && (
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <h4 className="text-sm font-medium text-gray-700">
                      {currentPosition ? 'Change Position' : 'Select Position'}
                    </h4>
                    <select
                      value={equipFilter}
                      onChange={(e) => setEquipFilter(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="All">All Equipment</option>
                      {equipmentOptions.map((eq) => (
                        <option key={eq} value={eq}>{eq}</option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    {currentPosition && (
                      <button
                        onClick={() => setShowPositionPicker(false)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {filtered.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-500">No positions found.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
                      {filtered.map((pos) => (
                        <div
                          key={pos.id}
                          className={`group overflow-hidden rounded-lg border transition-all ${
                            pos.id === selectedTemplate?.positionId
                              ? 'border-blue-400 ring-2 ring-blue-200'
                              : 'border-gray-200 hover:border-blue-400 hover:shadow-md'
                          }`}
                        >
                          <div
                            className="relative cursor-pointer"
                            onClick={() => setPreviewImageUrl(pos.publicUrl)}
                          >
                            <img src={pos.publicUrl} alt={pos.name} className="aspect-[3/4] w-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all">
                              <svg className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                              </svg>
                            </div>
                          </div>
                          <button
                            onClick={() => { onPositionSelect(pos.id, pos.name); setShowPositionPicker(false); }}
                            className="w-full p-1.5 text-left hover:bg-blue-50 transition-colors"
                          >
                            <p className="truncate text-xs font-medium text-gray-900">{pos.name}</p>
                            <p className="truncate text-[10px] text-gray-500">{pos.equipmentType}</p>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ===================== PAGE 2: GENERATE ===================== */}
        {page === 'generate' && (
          <div className="flex-1 overflow-y-auto">
            {/* Video Frames - click to add as reference */}
            {hasVideo && (
              <div className="border-b px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-700">Video Frames</h4>
                  <span className="text-xs text-gray-400">Click a frame to add as reference</span>
                </div>

                {framesLoading ? (
                  <div className="flex items-center gap-2 py-6 justify-center">
                    <svg className="h-5 w-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm text-gray-500">
                      {framesProgress
                        ? `Extracting frame ${framesProgress.current} of ${framesProgress.total}...`
                        : 'Loading video...'}
                    </span>
                  </div>
                ) : frames.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                    {frames.map((frame, i) => (
                      <div
                        key={i}
                        onClick={() => addImageFromDataUrl(frame.dataUrl)}
                        className={`flex-shrink-0 cursor-pointer rounded-lg overflow-hidden transition-all ${
                          images.length >= 3
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:ring-2 hover:ring-blue-400'
                        }`}
                      >
                        <img
                          src={frame.dataUrl}
                          alt={`Frame ${i + 1}`}
                          className="h-48 w-auto object-cover"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 py-2">Could not extract frames from video.</p>
                )}
              </div>
            )}

            {/* Reference Images */}
            <div className="px-4 pt-4 pb-2">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Reference Images ({images.length}/3)
              </label>
              <div className="flex flex-wrap gap-4">
                {images.map((img, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={img}
                      alt={`Reference ${idx + 1}`}
                      className="h-32 w-32 rounded-lg border border-gray-200 object-cover"
                    />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {images.length < 3 && (
                  <div className="flex h-32 w-32 flex-col items-stretch overflow-hidden rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                    <label className="flex flex-1 cursor-pointer flex-col items-center justify-center hover:bg-gray-100">
                      <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      <span className="text-xs text-gray-500">Upload File</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                    <button
                      onClick={() => setShowPositionGrid(!showPositionGrid)}
                      className="flex flex-1 flex-col items-center justify-center border-t border-gray-300 hover:bg-gray-100"
                    >
                      <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                      <span className="text-xs text-gray-500">From Positions</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Inline position picker (expandable) */}
            {showPositionGrid && (
              <div className="mx-4 mb-2 border border-gray-200 rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">Pick a position to add as reference</span>
                  <div className="flex items-center gap-2">
                    <select
                      value={genEquipFilter}
                      onChange={(e) => setGenEquipFilter(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="All">All</option>
                      {equipmentOptions.map((eq) => (
                        <option key={eq} value={eq}>{eq}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setShowPositionGrid(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {genFiltered.length === 0 ? (
                    <p className="py-4 text-center text-xs text-gray-400">No positions found.</p>
                  ) : (
                    <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-8">
                      {genFiltered.map((pos) => (
                        <button
                          key={pos.id}
                          onClick={() => addImageFromUrl(pos.publicUrl)}
                          className="group overflow-hidden rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow transition-all"
                        >
                          <img src={pos.publicUrl} alt={pos.name} className="aspect-[3/4] w-full object-cover" />
                          <p className="truncate text-[10px] text-gray-700 px-1 py-0.5">{pos.name}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Prompt */}
            <div className="px-4 pb-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Describe what you want to generate..."
              />

              {/* Prompt History */}
              {promptHistory.length > 0 && (
                <div className="mt-1" ref={historyRef}>
                  <div className="relative">
                    <button
                      onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Prompt History ({promptHistory.length})
                      <svg className={`h-3.5 w-3.5 transition-transform ${showHistoryDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {showHistoryDropdown && (
                      <div className="absolute left-0 top-full z-10 mt-1 w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-lg">
                        <div className="max-h-48 overflow-y-auto">
                          {promptHistory.map((p, idx) => (
                            <div
                              key={idx}
                              onClick={() => { setPrompt(p); setShowHistoryDropdown(false); }}
                              className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-gray-50"
                            >
                              <span className="line-clamp-2 flex-1 text-xs text-gray-700">{p}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deletePromptFromHistory(p);
                                  setPromptHistory(getPromptHistory());
                                }}
                                className="ml-2 flex-shrink-0 text-gray-400 hover:text-red-500"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-gray-100 px-3 py-1.5">
                          <button
                            onClick={() => { clearPromptHistory(); setPromptHistory([]); setShowHistoryDropdown(false); }}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Clear all history
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Generate + Result */}
            <div className="px-4 pb-4">
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={handleGenerate}
                  disabled={images.length === 0 || isGenerating}
                  className="px-5 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating...
                    </span>
                  ) : 'Generate'}
                </button>

                {generatedImageUrl && (
                  <>
                    <button
                      onClick={handleUseGeneratedImage}
                      disabled={isSavingGenerated}
                      className="px-5 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {isSavingGenerated ? 'Saving...' : 'Use This'}
                    </button>
                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>

              {/* Generated result */}
              {(isGenerating || generatedImageUrl) && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Result</label>
                  {isGenerating ? (
                    <div className="flex h-40 w-36 flex-col items-center justify-center rounded-lg border-2 border-dashed border-purple-300 bg-purple-50">
                      <svg className="h-6 w-6 animate-spin text-purple-600" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-xs text-purple-600 mt-2">Generating...</p>
                    </div>
                  ) : generatedImageUrl ? (
                    <img
                      src={generatedImageUrl}
                      alt="Generated"
                      className="h-40 w-auto rounded-lg border border-green-300 object-cover cursor-pointer"
                      onClick={() => setPreviewImageUrl(generatedImageUrl)}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full-size image preview */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={(e) => { e.stopPropagation(); setPreviewImageUrl(null); }}
        >
          <img src={previewImageUrl} alt="Preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
