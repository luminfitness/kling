'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { DropboxVideo, Position } from '@/types';

interface DropboxPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  video: DropboxVideo;
  onSave: (positionImageUrl: string, poseFrameTime: number) => void;
  positions: Position[];
  getVideoLink: (video: DropboxVideo) => Promise<string>;
}

interface ExtractedFrame {
  time: number;
  dataUrl: string;
}

interface ImageSlot {
  id: string;
  label: string;
  required: boolean;
  image: string | null; // base64 or URL
  file: File | null;
}

// Helper to convert File to base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DropboxPositionModal({
  isOpen,
  onClose,
  video,
  onSave,
  positions,
  getVideoLink,
}: DropboxPositionModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  // Video playback state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Frame extraction state
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
  const [isExtractingFrames, setIsExtractingFrames] = useState(false);
  const [selectedFrameTime, setSelectedFrameTime] = useState<number | null>(null);

  // Image slots state
  const [slots, setSlots] = useState<ImageSlot[]>([
    { id: 'pose', label: 'Pose Reference', required: true, image: null, file: null },
    { id: 'character', label: 'Character + Background', required: true, image: null, file: null },
    { id: 'equipment1', label: 'Equipment 1', required: false, image: null, file: null },
    { id: 'equipment2', label: 'Equipment 2', required: false, image: null, file: null },
    { id: 'equipment3', label: 'Equipment 3', required: false, image: null, file: null },
  ]);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPositionUrl, setGeneratedPositionUrl] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load video when modal opens
  useEffect(() => {
    if (isOpen && !videoUrl) {
      loadVideo();
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setVideoUrl(null);
      setVideoError(null);
      setExtractedFrames([]);
      setSelectedFrameTime(null);
      setSlots([
        { id: 'pose', label: 'Pose Reference', required: true, image: null, file: null },
        { id: 'character', label: 'Character + Background', required: true, image: null, file: null },
        { id: 'equipment1', label: 'Equipment 1', required: false, image: null, file: null },
        { id: 'equipment2', label: 'Equipment 2', required: false, image: null, file: null },
        { id: 'equipment3', label: 'Equipment 3', required: false, image: null, file: null },
      ]);
      setGeneratedPositionUrl(null);
      setGenerationError(null);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [isOpen]);

  const loadVideo = async () => {
    setIsLoadingVideo(true);
    setVideoError(null);
    try {
      const url = await getVideoLink(video);
      setVideoUrl(url);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      setIsLoadingVideo(false);
    }
  };

  // Extract frames from video
  const extractFrames = useCallback(async () => {
    if (!videoRef.current || !videoUrl) return;

    setIsExtractingFrames(true);
    setExtractedFrames([]);

    try {
      const video = videoRef.current;
      const videoDuration = video.duration;
      const interval = 0.5; // Extract frame every 0.5 seconds
      const maxFrames = 40;
      const frameTimes: number[] = [];

      for (let t = 0; t < videoDuration && frameTimes.length < maxFrames; t += interval) {
        frameTimes.push(t);
      }

      const frames: ExtractedFrame[] = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Scale to max 360px height for thumbnails
      const maxHeight = 360;
      const scale = Math.min(1, maxHeight / video.videoHeight);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const extractFrame = (time: number): Promise<ExtractedFrame> => {
        return new Promise((resolveFrame) => {
          video.currentTime = time;
          video.onseeked = () => {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolveFrame({ time, dataUrl });
          };
        });
      };

      for (const time of frameTimes) {
        try {
          const frame = await extractFrame(time);
          frames.push(frame);
          setExtractedFrames([...frames]); // Update progressively
        } catch {
          // Skip failed frames
        }
      }

      setExtractedFrames(frames);
    } catch (err) {
      console.error('Frame extraction error:', err);
    } finally {
      setIsExtractingFrames(false);
    }
  }, [videoUrl]);

  // Capture current frame
  const captureCurrentFrame = useCallback(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');

    // Set as pose reference
    setSlots((prev) =>
      prev.map((s) =>
        s.id === 'pose' ? { ...s, image: dataUrl, file: null } : s
      )
    );
    setSelectedFrameTime(video.currentTime);
  }, []);

  // Select frame from grid
  const selectFrame = useCallback((frame: ExtractedFrame) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === 'pose' ? { ...s, image: frame.dataUrl, file: null } : s
      )
    );
    setSelectedFrameTime(frame.time);
  }, []);

  // Handle file upload for a slot
  const handleFileUpload = async (slotId: string, file: File) => {
    const base64 = await fileToBase64(file);
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId ? { ...s, image: base64, file } : s
      )
    );
  };

  // Select existing position as character reference
  const selectExistingPosition = (position: Position, slotId: string) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId ? { ...s, image: position.publicUrl, file: null } : s
      )
    );
  };

  // Clear a slot
  const clearSlot = (slotId: string) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId ? { ...s, image: null, file: null } : s
      )
    );
    if (slotId === 'pose') {
      setSelectedFrameTime(null);
    }
  };

  // Generate position image
  const handleGeneratePosition = async () => {
    const poseSlot = slots.find((s) => s.id === 'pose');
    const characterSlot = slots.find((s) => s.id === 'character');

    if (!poseSlot?.image || !characterSlot?.image) {
      setGenerationError('Please provide both pose reference and character/background');
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setGeneratedPositionUrl(null);

    try {
      // Build images array for the API
      const images = {
        poseReference: poseSlot.image,
        characterBackground: characterSlot.image,
        equipment1: slots.find((s) => s.id === 'equipment1')?.image || undefined,
        equipment2: slots.find((s) => s.id === 'equipment2')?.image || undefined,
        equipment3: slots.find((s) => s.id === 'equipment3')?.image || undefined,
      };

      const response = await fetch('/api/dropbox/generate-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseName: video.exerciseName,
          ...images,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate position');
      }

      setGeneratedPositionUrl(data.imageUrl);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  // Save the generated position
  const handleSave = async () => {
    if (!generatedPositionUrl || selectedFrameTime === null) {
      setGenerationError('Please generate a position first');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(generatedPositionUrl, selectedFrameTime);
      onClose();
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Create Position</h2>
            <p className="text-sm text-gray-500">{video.exerciseName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Left: Video Player & Frame Selector */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Video Preview</h3>

                {isLoadingVideo ? (
                  <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-blue-500 border-t-transparent mb-2" />
                      <p className="text-sm text-gray-500">Loading video...</p>
                    </div>
                  </div>
                ) : videoError ? (
                  <div className="aspect-video bg-red-50 rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-sm text-red-600 mb-2">{videoError}</p>
                      <button
                        onClick={loadVideo}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : videoUrl ? (
                  <div className="space-y-2">
                    <div className="rounded-lg overflow-hidden bg-black">
                      <video
                        ref={videoRef}
                        src={videoUrl}
                        crossOrigin="anonymous"
                        className="w-full"
                        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                      />
                    </div>

                    {/* Video Controls */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => videoRef.current?.play()}
                        className="p-1.5 rounded bg-gray-100 hover:bg-gray-200"
                        title="Play"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => videoRef.current?.pause()}
                        className="p-1.5 rounded bg-gray-100 hover:bg-gray-200"
                        title="Pause"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          if (videoRef.current) videoRef.current.currentTime -= 0.033;
                        }}
                        className="p-1.5 rounded bg-gray-100 hover:bg-gray-200"
                        title="Previous frame"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          if (videoRef.current) videoRef.current.currentTime += 0.033;
                        }}
                        className="p-1.5 rounded bg-gray-100 hover:bg-gray-200"
                        title="Next frame"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                        </svg>
                      </button>
                      <span className="text-xs text-gray-500 ml-2">
                        {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
                      </span>
                    </div>

                    {/* Timeline scrubber */}
                    <input
                      type="range"
                      min={0}
                      max={duration}
                      step={0.033}
                      value={currentTime}
                      onChange={(e) => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = parseFloat(e.target.value);
                        }
                      }}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />

                    {/* Capture button */}
                    <div className="flex gap-2">
                      <button
                        onClick={captureCurrentFrame}
                        className="flex-1 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
                      >
                        Capture This Frame
                      </button>
                      <button
                        onClick={extractFrames}
                        disabled={isExtractingFrames}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isExtractingFrames ? 'Extracting...' : 'Extract All'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Frame Grid */}
              {extractedFrames.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Select Frame ({extractedFrames.length} frames)
                  </h3>
                  <div className="grid grid-cols-5 gap-1 max-h-40 overflow-y-auto p-2 bg-gray-50 rounded-lg">
                    {extractedFrames.map((frame, idx) => (
                      <button
                        key={idx}
                        onClick={() => selectFrame(frame)}
                        className={`aspect-video rounded overflow-hidden border-2 transition-colors ${
                          selectedFrameTime === frame.time
                            ? 'border-purple-500'
                            : 'border-transparent hover:border-gray-300'
                        }`}
                      >
                        <img
                          src={frame.dataUrl}
                          alt={`Frame at ${frame.time.toFixed(1)}s`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Image Slots & Generation */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-700">Image Inputs</h3>

              {/* Image Slots Grid */}
              <div className="space-y-3">
                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className={`p-3 rounded-lg border ${
                      slot.image
                        ? 'bg-green-50 border-green-200'
                        : slot.required
                        ? 'bg-gray-50 border-gray-200'
                        : 'bg-gray-50 border-dashed border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        {slot.label}
                        {slot.required && <span className="text-red-500 ml-1">*</span>}
                      </span>
                      {slot.image && (
                        <button
                          onClick={() => clearSlot(slot.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {slot.image ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={slot.image}
                          alt={slot.label}
                          className="w-16 h-16 object-cover rounded"
                        />
                        <span className="text-xs text-green-600">Ready</span>
                      </div>
                    ) : slot.id === 'pose' ? (
                      <p className="text-xs text-gray-500">
                        Use the video controls to capture a frame
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          ref={(el) => { fileInputRefs.current[slot.id] = el; }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(slot.id, file);
                          }}
                        />
                        <button
                          onClick={() => fileInputRefs.current[slot.id]?.click()}
                          className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                        >
                          Upload
                        </button>
                        {slot.id === 'character' && positions.length > 0 && (
                          <select
                            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded"
                            onChange={(e) => {
                              const pos = positions.find((p) => p.id === e.target.value);
                              if (pos) selectExistingPosition(pos, slot.id);
                            }}
                            value=""
                          >
                            <option value="">Select existing...</option>
                            {positions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGeneratePosition}
                disabled={!slots.find((s) => s.id === 'pose')?.image || !slots.find((s) => s.id === 'character')?.image || isGenerating}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Generating...
                  </span>
                ) : (
                  'Generate Position'
                )}
              </button>

              {generationError && (
                <p className="text-sm text-red-600">{generationError}</p>
              )}

              {/* Generated Result */}
              {generatedPositionUrl && (
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <h3 className="text-sm font-medium text-green-700 mb-2">Generated Position</h3>
                  <img
                    src={generatedPositionUrl}
                    alt="Generated position"
                    className="w-full rounded-lg border border-green-300"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setGeneratedPositionUrl(null)}
                      className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Regenerate
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:bg-gray-300"
                    >
                      {isSaving ? 'Saving...' : 'Save Position'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
