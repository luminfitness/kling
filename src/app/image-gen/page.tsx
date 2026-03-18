'use client';

import { useState, useEffect, useRef } from 'react';
import { usePositions } from '@/hooks/usePositions';
import { useEquipment } from '@/hooks/useEquipment';
import {
  getPromptHistory,
  savePromptToHistory,
  deletePromptFromHistory,
  clearPromptHistory,
} from '@/lib/promptHistory';
import ImageResizeEditor from '@/components/ImageResizeEditor';
import ExerciseFramePickerModal from '@/components/ExerciseFramePickerModal';
import CanvaEditor from '@/components/CanvaEditor';

interface GeneratedImage {
  dataUrl: string;
  index: number;
}

interface BatchResult {
  poseIndex: number;
  poseDataUrl: string;
  images: GeneratedImage[];
  error?: string;
  pending?: boolean;
}

export default function ImageGenPage() {
  const { positions } = usePositions();
  const { allEquipmentNames } = useEquipment();

  const STANDING_POSITION_ID = '2394f11a-d011-4739-96a2-46384c3ab46f';
  const PINNED_POSITION_NAMES = ['standing', 'standing r', 'side-to-side hops', 'standing l', 'dropsquat_bodyweight'];

  // Mode: generate, edit, or canva
  const [mode, setMode] = useState<'generate' | 'edit' | 'canva'>('edit');

  // Generate mode: single reference image (max 1)
  // Edit mode: images to edit (unlimited)
  const [images, setImages] = useState<string[]>([]);

  // Generate mode: pose images for batch (unlimited)
  const [poseImages, setPoseImages] = useState<string[]>([]);
  const [poseDragOver, setPoseDragOver] = useState(false);

  // Edit mode: optional single reference image
  const [editReference, setEditReference] = useState<string | null>(null);
  const [editRefDragOver, setEditRefDragOver] = useState(false);

  // Results
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [retryingPoses, setRetryingPoses] = useState<Set<number>>(new Set());
  const activeRetriesRef = useRef(0);
  const retryQueueRef = useRef<Array<() => void>>([]);

  // Shared state
  const [prompt, setPrompt] = useState('Make the character in the 1st reference image be in the pose and positioning as the 2nd photo and holding the equipment in the same way');
  const [outputCount, setOutputCount] = useState(3);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resizeEditorImage, setResizeEditorImage] = useState<string | null>(null);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [exercisePickerTarget, setExercisePickerTarget] = useState<'reference' | 'pose' | 'edit'>('pose');

  const [refDragOver, setRefDragOver] = useState(false);

  // Position picker
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [equipmentFilter, setEquipmentFilter] = useState('All');
  const [positionSearch, setPositionSearch] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const poseInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const editRefInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const maxImages = mode === 'edit' ? 10 : 1;

  useEffect(() => {
    setPromptHistory(getPromptHistory());
  }, []);

  const standingLoadedRef = useRef(false);
  useEffect(() => {
    if (mode !== 'generate') return;
    if (standingLoadedRef.current || positions.length === 0) return;
    const standing = positions.find(p => p.id === STANDING_POSITION_ID);
    if (!standing) return;
    standingLoadedRef.current = true;
    loadPositionImage(standing.publicUrl);
  }, [positions, mode]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const MAX_SIZE = 1024;
          let width = img.width;
          let height = img.height;
          if (width > MAX_SIZE || height > MAX_SIZE) {
            if (width > height) {
              height = (height / width) * MAX_SIZE;
              width = MAX_SIZE;
            } else {
              width = (width / height) * MAX_SIZE;
              height = MAX_SIZE;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const resizeFromUrl = (url: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const MAX_SIZE = 1024;
        let width = img.width;
        let height = img.height;
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = (height / width) * MAX_SIZE;
            width = MAX_SIZE;
          } else {
            width = (width / height) * MAX_SIZE;
            height = MAX_SIZE;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = url;
    });
  };

  const loadPositionImage = async (publicUrl: string) => {
    const dataUrl = await resizeFromUrl(publicUrl);
    setImages((prev) => [...prev, dataUrl].slice(0, maxImages));
    setShowPositionPicker(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remainingSlots = maxImages - images.length;
    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    for (const file of filesToProcess) {
      const resized = await resizeImage(file);
      setImages((prev) => [...prev, resized].slice(0, maxImages));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEditImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const filesToProcess = Array.from(files);
    for (const file of filesToProcess) {
      const resized = await resizeImage(file);
      setImages((prev) => [...prev, resized]);
    }
    if (editInputRef.current) editInputRef.current.value = '';
  };

  const handleEditRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const resized = await resizeImage(files[0]);
    setEditReference(resized);
    if (editRefInputRef.current) editRefInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handlePoseUpload = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      const resized = await resizeImage(file);
      setPoseImages((prev) => [...prev, resized]);
    }
  };

  const handlePoseInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    await handlePoseUpload(e.target.files);
    if (poseInputRef.current) poseInputRef.current.value = '';
  };

  const removePose = (index: number) => {
    setPoseImages((prev) => prev.filter((_, i) => i !== index));
  };

  const switchMode = (newMode: 'generate' | 'edit' | 'canva') => {
    if (newMode === mode) return;
    setMode(newMode);
    setImages([]);
    setPoseImages([]);
    setEditReference(null);
    setResults([]);
    setBatchResults([]);
    setBatchProgress(null);
    setError(null);
    if (newMode === 'generate') {
      // Reload standing position for generate mode
      standingLoadedRef.current = false;
      const standing = positions.find(p => p.id === STANDING_POSITION_ID);
      if (standing) {
        standingLoadedRef.current = true;
        resizeFromUrl(standing.publicUrl).then(dataUrl => {
          setImages([dataUrl]);
        });
      }
    }
  };

  const CHUNK_SIZE = 3;

  const handleGenerate = async () => {
    if (mode === 'edit') {
      if (images.length === 0) { setError('Please upload at least one image to edit'); return; }
    } else {
      if (images.length === 0) { setError('Please upload a reference image'); return; }
    }
    if (!prompt.trim()) { setError('Please enter a prompt'); return; }
    setError(null);

    if (mode === 'edit') {
      // Edit batch: each image gets its own API call
      setIsGenerating(true);
      setResults([]);
      setBatchProgress({ done: 0, total: images.length });
      setBatchResults(images.map((imgDataUrl, idx) => ({
        poseIndex: idx,
        poseDataUrl: imgDataUrl,
        images: [],
        pending: true,
      })));

      for (let i = 0; i < images.length; i += CHUNK_SIZE) {
        const chunk = images.slice(i, i + CHUNK_SIZE);
        await Promise.allSettled(
          chunk.map(async (image, j) => {
            const imageIndex = i + j;
            try {
              const apiImages = editReference ? [image, editReference] : [image];
              const res = await fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images: apiImages, prompt: prompt.trim(), outputCount }),
              });
              const data = await res.json();
              const genImages: GeneratedImage[] = (data.images || []).map((url: string, idx: number) => ({ dataUrl: url, index: idx }));
              setBatchResults(prev => prev.map(r => r.poseIndex === imageIndex ? { ...r, images: genImages, pending: false } : r));
            } catch (err) {
              setBatchResults(prev => prev.map(r => r.poseIndex === imageIndex ? { ...r, images: [], error: err instanceof Error ? err.message : 'Failed', pending: false } : r));
            }
            setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
          })
        );
      }

      savePromptToHistory(prompt.trim());
      setPromptHistory(getPromptHistory());
      setIsGenerating(false);
      setBatchProgress(null);
    } else if (poseImages.length === 0) {
      // Single generation (generate mode, no poses)
      setIsGenerating(true);
      setResults([]);
      try {
        const response = await fetch('/api/image-gen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images, prompt: prompt.trim(), outputCount }),
        });
        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
          const text = await response.text();
          console.error('[image-gen] Non-JSON response:', text.substring(0, 200));
          if (response.status === 413) throw new Error('Images are too large. Try using smaller images.');
          throw new Error(`Server error (${response.status}). Try using smaller images or fewer images.`);
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to generate images');
        savePromptToHistory(prompt.trim());
        setPromptHistory(getPromptHistory());
        setResults(data.images.map((dataUrl: string, index: number) => ({ dataUrl, index })));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsGenerating(false);
      }
    } else {
      // Batch generation (generate mode with poses)
      setIsGenerating(true);
      setResults([]);
      setBatchProgress({ done: 0, total: poseImages.length });
      setBatchResults(poseImages.map((poseDataUrl, idx) => ({
        poseIndex: idx,
        poseDataUrl,
        images: [],
        pending: true,
      })));

      for (let i = 0; i < poseImages.length; i += CHUNK_SIZE) {
        const chunk = poseImages.slice(i, i + CHUNK_SIZE);
        await Promise.allSettled(
          chunk.map(async (poseImage, j) => {
            const poseIndex = i + j;
            try {
              const res = await fetch('/api/image-gen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images: [...images, poseImage], prompt: prompt.trim(), outputCount }),
              });
              const data = await res.json();
              const genImages: GeneratedImage[] = (data.images || []).map((url: string, idx: number) => ({ dataUrl: url, index: idx }));
              setBatchResults(prev => prev.map(r => r.poseIndex === poseIndex ? { ...r, images: genImages, pending: false } : r));
            } catch (err) {
              setBatchResults(prev => prev.map(r => r.poseIndex === poseIndex ? { ...r, images: [], error: err instanceof Error ? err.message : 'Failed', pending: false } : r));
            }
            setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
          })
        );
      }

      savePromptToHistory(prompt.trim());
      setPromptHistory(getPromptHistory());
      setIsGenerating(false);
      setBatchProgress(null);
    }
  };

  const runNextRetry = () => {
    if (retryQueueRef.current.length > 0 && activeRetriesRef.current < CHUNK_SIZE) {
      const next = retryQueueRef.current.shift()!;
      next();
    }
  };

  const handleRetryPose = (poseIndex: number, poseDataUrl: string) => {
    const execute = async () => {
      activeRetriesRef.current++;
      setRetryingPoses(prev => new Set(prev).add(poseIndex));
      setBatchResults(prev => prev.map(r => r.poseIndex === poseIndex ? { ...r, images: [], error: undefined, pending: true } : r));
      try {
        let apiImages: string[];
        if (mode === 'edit') {
          apiImages = editReference ? [poseDataUrl, editReference] : [poseDataUrl];
        } else {
          apiImages = [...images, poseDataUrl];
        }
        const res = await fetch('/api/image-gen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: apiImages, prompt: prompt.trim(), outputCount }),
        });
        const data = await res.json();
        const genImages: GeneratedImage[] = (data.images || []).map((url: string, idx: number) => ({ dataUrl: url, index: idx }));
        setBatchResults(prev => prev.map(r => r.poseIndex === poseIndex ? { poseIndex, poseDataUrl, images: genImages, error: data.error } : r));
      } catch (err) {
        setBatchResults(prev => prev.map(r => r.poseIndex === poseIndex ? { poseIndex, poseDataUrl, images: [], error: err instanceof Error ? err.message : 'Failed' } : r));
      } finally {
        activeRetriesRef.current--;
        setRetryingPoses(prev => {
          const next = new Set(prev);
          next.delete(poseIndex);
          return next;
        });
        runNextRetry();
      }
    };

    if (activeRetriesRef.current < CHUNK_SIZE) {
      execute();
    } else {
      retryQueueRef.current.push(execute);
    }
  };

  const handleDownload = (dataUrl: string, index: number) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `generated-image-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectPromptFromHistory = (p: string) => {
    setPrompt(p);
    setShowHistoryDropdown(false);
  };

  const handleDeleteFromHistory = (e: React.MouseEvent, p: string) => {
    e.stopPropagation();
    deletePromptFromHistory(p);
    setPromptHistory(getPromptHistory());
  };

  const handleClearHistory = () => {
    clearPromptHistory();
    setPromptHistory([]);
    setShowHistoryDropdown(false);
  };

  const renderResultCard = (result: GeneratedImage, keyPrefix: string) => (
    <div key={`${keyPrefix}-${result.index}`} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <img src={result.dataUrl} alt={`Result ${result.index + 1}`} className="aspect-[9/16] w-full object-cover" />
      <div className="flex gap-2 p-2">
        <button
          onClick={() => handleDownload(result.dataUrl, result.index)}
          className="flex-1 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
        >
          Download
        </button>
        <button
          onClick={() => setResizeEditorImage(result.dataUrl)}
          className="flex-1 rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200"
        >
          Resize
        </button>
      </div>
    </div>
  );

  const isEditMode = mode === 'edit';
  const batchTotal = isEditMode ? images.length : poseImages.length;

  // Shared prompt + history + output count + generate button
  const renderPromptAndControls = () => (
    <>
      {/* Prompt */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-gray-700">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={isEditMode ? "Describe how to edit each image..." : "Describe what you want to generate..."}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Prompt History */}
      {promptHistory.length > 0 && (
        <div className="mb-4" ref={historyRef}>
          <div className="relative">
            <button
              onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Prompt History ({promptHistory.length})
              <svg className={`h-4 w-4 transition-transform ${showHistoryDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showHistoryDropdown && (
              <div className="absolute left-0 top-full z-10 mt-1 w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-lg">
                <div className="max-h-60 overflow-y-auto">
                  {promptHistory.map((p, idx) => (
                    <div key={idx} onClick={() => selectPromptFromHistory(p)} className="flex cursor-pointer items-center justify-between px-4 py-2 hover:bg-gray-50">
                      <span className="line-clamp-2 flex-1 text-sm text-gray-700">{p}</span>
                      <button onClick={(e) => handleDeleteFromHistory(e, p)} className="ml-2 text-gray-400 hover:text-red-500">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-100 px-4 py-2">
                  <button onClick={handleClearHistory} className="text-sm text-red-500 hover:text-red-700">
                    Clear all history
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Output Count + Generate Button */}
      <div className="mb-8 flex items-center gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {isEditMode ? 'Outputs per image' : poseImages.length > 0 ? 'Outputs per pose' : 'Outputs'}
          </label>
          <select
            value={outputCount}
            onChange={(e) => setOutputCount(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || images.length === 0}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isGenerating ? (
              <>
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {isEditMode ? 'Editing...' : 'Generating...'}
              </>
            ) : isEditMode && images.length > 1
              ? `Edit All (${images.length} images)`
              : poseImages.length > 0
              ? `Generate All (${poseImages.length} pose${poseImages.length !== 1 ? 's' : ''})`
              : isEditMode ? 'Edit' : 'Generate'
            }
          </button>
          {batchProgress && (
            <span className="text-sm text-gray-600">
              {batchProgress.done}/{batchProgress.total} complete
            </span>
          )}
        </div>
      </div>
    </>
  );

  // Shared results rendering
  const renderResults = () => (
    <>
      {/* Single Results */}
      {results.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Results</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {results.map((result) => renderResultCard(result, 'single'))}
          </div>
        </div>
      )}

      {/* Batch Results */}
      {batchResults.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Results ({batchResults.filter(r => !r.pending).length}/{batchTotal})
          </h2>
          <div className="space-y-6">
            {[...batchResults]
              .sort((a, b) => a.poseIndex - b.poseIndex)
              .map((group) => {
                const isRetrying = retryingPoses.has(group.poseIndex);
                return (
                <div key={group.poseIndex} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {/* Source reference card */}
                    <div className="flex-shrink-0 overflow-hidden rounded-lg border-2 border-blue-400 bg-white" style={{ width: '160px' }}>
                      <img src={group.poseDataUrl} alt={`${isEditMode ? 'Image' : 'Pose'} ${group.poseIndex + 1}`} className="aspect-[9/16] w-full object-cover" />
                      <div className="px-2 py-1.5 text-center space-y-1">
                        <span className="text-xs font-semibold text-blue-600">{isEditMode ? 'Image' : 'Pose'} {group.poseIndex + 1}</span>
                        {group.error && <p className="text-xs text-red-600">{group.error}</p>}
                        <button
                          onClick={() => handleRetryPose(group.poseIndex, group.poseDataUrl)}
                          disabled={isRetrying || isGenerating}
                          className="w-full rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRetrying ? (
                            <span className="flex items-center justify-center gap-1">
                              <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Retrying...
                            </span>
                          ) : 'Retry'}
                        </button>
                      </div>
                    </div>
                    {/* Generated results or loading placeholders */}
                    {(isRetrying || group.pending) ? (
                      Array.from({ length: outputCount }).map((_, i) => (
                        <div key={i} className="flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white" style={{ width: '160px' }}>
                          <div className="flex aspect-[9/16] w-full items-center justify-center bg-gray-100">
                            <svg className="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          </div>
                        </div>
                      ))
                    ) : (
                      group.images.map((result) => (
                        <div key={result.index} className="flex-shrink-0" style={{ width: '160px' }}>
                          {renderResultCard(result, `batch-${group.poseIndex}`)}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Image Generator</h1>

      {/* Mode Toggle — 3 tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1 w-fit">
        <button
          onClick={() => switchMode('generate')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${mode === 'generate' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
        >
          Generate
        </button>
        <button
          onClick={() => switchMode('edit')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${mode === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
        >
          Edit
        </button>
        <button
          onClick={() => switchMode('canva')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${mode === 'canva' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
        >
          Canva
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-700">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {mode === 'canva' ? (
        <CanvaEditor />
      ) : mode === 'edit' ? (
        <>
          {/* EDIT MODE */}

          {/* Images to Edit */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Images to Edit ({images.length})
            </label>
            <div
              className={`rounded-lg border-2 border-dashed p-4 transition-colors ${refDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
              onDragOver={(e) => { e.preventDefault(); setRefDragOver(true); }}
              onDragLeave={() => setRefDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setRefDragOver(false);
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                for (const file of files) {
                  const resized = await resizeImage(file);
                  setImages((prev) => [...prev, resized]);
                }
              }}
            >
              {images.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <svg className="mb-2 h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm text-gray-500">Drag & drop images to edit here, or</p>
                  <div className="mt-2 flex gap-2">
                    <label className="cursor-pointer rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50">
                      Browse Files
                      <input ref={editInputRef} type="file" accept="image/*" multiple onChange={handleEditImageUpload} className="hidden" />
                    </label>
                    <button
                      onClick={() => { setExercisePickerTarget('edit'); setShowExercisePicker(true); }}
                      className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50"
                    >
                      From Exercises
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={img} alt={`Edit ${idx + 1}`} className="h-24 w-24 rounded-lg border border-gray-200 object-cover" />
                      <div className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                        {idx + 1}
                      </div>
                      <button onClick={() => removeImage(idx)} className="absolute -right-2 -top-2 rounded-full bg-red-500 p-0.5 text-white hover:bg-red-600">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 hover:bg-gray-100">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="mt-1 text-xs text-gray-500">Add More</span>
                    <input type="file" accept="image/*" multiple onChange={handleEditImageUpload} className="hidden" />
                  </label>
                  <button
                    onClick={() => { setExercisePickerTarget('edit'); setShowExercisePicker(true); }}
                    className="flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                    </svg>
                    <span className="mt-1 text-xs">Exercises</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Optional Reference Image */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Reference Image <span className="font-normal text-gray-400">— optional, included with every edit</span>
            </label>
            <div
              className={`flex items-center gap-4 rounded-lg p-2 transition-colors ${editRefDragOver ? 'bg-blue-50 ring-2 ring-blue-400' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (!editReference) setEditRefDragOver(true); }}
              onDragLeave={() => setEditRefDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setEditRefDragOver(false);
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                if (files.length > 0) {
                  const resized = await resizeImage(files[0]);
                  setEditReference(resized);
                }
              }}
            >
              {editReference ? (
                <div className="relative">
                  <img src={editReference} alt="Reference" className="h-32 w-32 rounded-lg border border-gray-200 object-cover" />
                  <button onClick={() => setEditReference(null)} className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="flex h-32 w-32 flex-col items-stretch overflow-hidden rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                  <label className="flex flex-1 cursor-pointer flex-col items-center justify-center hover:bg-gray-100">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span className="text-xs text-gray-500">Upload</span>
                    <input ref={editRefInputRef} type="file" accept="image/*" onChange={handleEditRefUpload} className="hidden" />
                  </label>
                  <button onClick={() => { setPositionSearch(''); setShowPositionPicker(true); }} className="flex flex-1 flex-col items-center justify-center border-t border-gray-300 hover:bg-gray-100">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    <span className="text-xs text-gray-500">Positions</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {renderPromptAndControls()}
          {renderResults()}
        </>
      ) : (
        <>
          {/* GENERATE MODE */}

          {/* Reference Image (single) */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Reference Image
            </label>
            <div
              className={`flex flex-wrap gap-4 rounded-lg p-2 transition-colors ${refDragOver ? 'bg-blue-50 ring-2 ring-blue-400' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (images.length < 1) setRefDragOver(true); }}
              onDragLeave={() => setRefDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setRefDragOver(false);
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                if (files.length > 0 && images.length < 1) {
                  const resized = await resizeImage(files[0]);
                  setImages([resized]);
                }
              }}
            >
              {images.map((img, idx) => (
                <div key={idx} className="relative">
                  <img src={img} alt="Reference" className="h-32 w-32 rounded-lg border border-gray-200 object-cover" />
                  <button onClick={() => removeImage(idx)} className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {images.length < 1 && (
                <div className="flex h-32 w-32 flex-col items-stretch overflow-hidden rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
                  <label className="flex flex-1 cursor-pointer flex-col items-center justify-center hover:bg-gray-100">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span className="text-xs text-gray-500">Upload File</span>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </label>
                  <button onClick={() => { setPositionSearch(''); setShowPositionPicker(true); }} className="flex flex-1 flex-col items-center justify-center border-t border-gray-300 hover:bg-gray-100">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    <span className="text-xs text-gray-500">From Positions</span>
                  </button>
                  <button onClick={() => { setExercisePickerTarget('reference'); setShowExercisePicker(true); }} className="flex flex-1 flex-col items-center justify-center border-t border-gray-300 hover:bg-gray-100">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                    </svg>
                    <span className="text-xs text-gray-500">From Exercises</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Pose Images */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Pose Images ({poseImages.length})
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setPoseDragOver(true); }}
              onDragLeave={() => setPoseDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setPoseDragOver(false);
                await handlePoseUpload(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
              }}
              className={`rounded-lg border-2 border-dashed p-4 transition-colors ${poseDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
            >
              {poseImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <svg className="mb-2 h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm text-gray-500">Drag & drop pose images here, or</p>
                  <div className="mt-2 flex gap-2">
                    <label className="cursor-pointer rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50">
                      Browse Files
                      <input ref={poseInputRef} type="file" accept="image/*" multiple onChange={handlePoseInputChange} className="hidden" />
                    </label>
                    <button
                      onClick={() => { setExercisePickerTarget('pose'); setShowExercisePicker(true); }}
                      className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50"
                    >
                      From Exercises
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {poseImages.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={img} alt={`Pose ${idx + 1}`} className="h-24 w-24 rounded-lg border border-gray-200 object-cover" />
                      <div className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                        {idx + 1}
                      </div>
                      <button onClick={() => removePose(idx)} className="absolute -right-2 -top-2 rounded-full bg-red-500 p-0.5 text-white hover:bg-red-600">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 hover:bg-gray-100">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="mt-1 text-xs text-gray-500">Add More</span>
                    <input type="file" accept="image/*" multiple onChange={handlePoseInputChange} className="hidden" />
                  </label>
                  <button
                    onClick={() => { setExercisePickerTarget('pose'); setShowExercisePicker(true); }}
                    className="flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                    </svg>
                    <span className="mt-1 text-xs">Exercises</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {renderPromptAndControls()}
          {renderResults()}
        </>
      )}

      {/* Exercise Frame Picker Modal */}
      {showExercisePicker && (
        <ExerciseFramePickerModal
          onClose={() => setShowExercisePicker(false)}
          onAddFrames={(frames) => {
            if (exercisePickerTarget === 'reference') {
              setImages((prev) => [...prev, ...frames].slice(0, maxImages));
            } else if (exercisePickerTarget === 'edit') {
              setImages((prev) => [...prev, ...frames]);
            } else {
              setPoseImages((prev) => [...prev, ...frames]);
            }
            setShowExercisePicker(false);
          }}
        />
      )}

      {/* Position Picker */}
      {showPositionPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Select Position</h2>
              <button onClick={() => setShowPositionPicker(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 flex gap-3">
                <input
                  type="text"
                  placeholder="Search positions..."
                  value={positionSearch}
                  onChange={(e) => setPositionSearch(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <select
                  value={equipmentFilter}
                  onChange={(e) => setEquipmentFilter(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="All">All Equipment</option>
                  {allEquipmentNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="grid max-h-96 grid-cols-4 gap-3 overflow-y-auto">
                {positions
                  .filter((p) => {
                    const matchesEquip = equipmentFilter === 'All' || p.equipmentType === equipmentFilter;
                    const matchesSearch = !positionSearch.trim() ||
                      p.name.toLowerCase().includes(positionSearch.toLowerCase());
                    return matchesEquip && matchesSearch;
                  })
                  .sort((a, b) => {
                    const aPin = PINNED_POSITION_NAMES.indexOf(a.name.toLowerCase());
                    const bPin = PINNED_POSITION_NAMES.indexOf(b.name.toLowerCase());
                    if (aPin !== -1 && bPin !== -1) return aPin - bPin;
                    if (aPin !== -1) return -1;
                    if (bPin !== -1) return 1;
                    return 0;
                  })
                  .map((position) => (
                    <button
                      key={position.id}
                      onClick={async () => {
                        if (isEditMode) {
                          // In edit mode, position picker sets the edit reference
                          const dataUrl = await resizeFromUrl(position.publicUrl);
                          setEditReference(dataUrl);
                          setShowPositionPicker(false);
                        } else {
                          loadPositionImage(position.publicUrl);
                        }
                      }}
                      className="overflow-hidden rounded-lg border-2 border-transparent bg-gray-50 hover:border-blue-400 hover:bg-blue-50"
                    >
                      <img src={position.publicUrl} alt={position.name} className="aspect-[9/16] w-full object-cover" />
                      <div className="p-1.5 text-center">
                        <p className="truncate text-xs font-medium text-gray-700">{position.name}</p>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Resize Editor */}
      {resizeEditorImage && (
        <ImageResizeEditor
          imageDataUrl={resizeEditorImage}
          onClose={() => setResizeEditorImage(null)}
        />
      )}
    </div>
  );
}
