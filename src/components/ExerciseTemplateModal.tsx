'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ExerciseTemplate } from '@/types';
import { usePositions } from '@/hooks/usePositions';
import { useEquipment } from '@/hooks/useEquipment';
import { trimVideo, getVideoDuration } from '@/lib/videoTrimmer';

interface SaveToLibraryParams {
  exerciseName: string;
  equipmentType: string;
  outputVideoUrl: string;
  inputVideoUrl: string;
  positionId: string;
  positionName: string;
  mode: 'std' | 'pro';
  costUsd: number;
  customPrompt?: string;
}

interface ExerciseTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: Omit<ExerciseTemplate, 'id' | 'createdAt'>) => void;
  onSaveToLibrary?: (params: SaveToLibraryParams) => Promise<unknown>;
  initialData?: ExerciseTemplate; // For editing/re-running
  mode: 'create' | 'edit';
}

// Frame extraction types
interface ExtractedFrame {
  time: number;
  dataUrl: string;
}

const DEFAULT_PROMPT = `The subject's entire body is fully visible in the frame from head to feet at all times. The subject holds the equipment in the correct grip for performing the exercise. The subject's posture and form are perfect, demonstrating proper technique throughout the movement. The subject's movements are smooth, controlled, and at an appropriate tempo for the exercise. The subject's body positioning and alignment are ideal for maximizing effectiveness and minimizing injury risk. Do not crop or cut off any part of the subject's body. The subject's facial expression remains neutral, calm, and relaxed throughout the entire video. Do not replicate or exaggerate any facial expressions, breathing movements, mouth movements, or chest heaving from the reference video. The face should remain still and composed at all times.`;

const DEFAULT_POSITION_PROMPT = "Make the character in the 1st reference image be in the pose of the second photo and holding the equipment in the same way. Keep the original background of 1st reference image.";

// Helper to convert File to base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper to convert base64 data URL to Blob
function base64ToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export default function ExerciseTemplateModal({
  isOpen,
  onClose,
  onSave,
  onSaveToLibrary,
  initialData,
  mode,
}: ExerciseTemplateModalProps) {
  const { positions, createPosition } = usePositions();
  const { allEquipmentNames } = useEquipment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const positionImageInputRef = useRef<HTMLInputElement>(null);

  const [exerciseName, setExerciseName] = useState('');
  const [equipmentType, setEquipmentType] = useState('Barbell');
  const [positionId, setPositionId] = useState('');
  const [customPositionUrl, setCustomPositionUrl] = useState('');
  const [isUploadingPosition, setIsUploadingPosition] = useState(false);
  const [isUploadingGeneratedPosition, setIsUploadingGeneratedPosition] = useState(false);
  const [characterOrientation, setCharacterOrientation] = useState<'image' | 'video'>('video');
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_PROMPT);

  // Position source mode: 'existing' | 'upload' | 'from-video'
  type PositionSourceMode = 'existing' | 'upload' | 'from-video';
  const [positionSourceMode, setPositionSourceMode] = useState<PositionSourceMode>('existing');

  // Frame extraction state (for from-video mode)
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
  const [selectedFrameUrl, setSelectedFrameUrl] = useState<string | null>(null);
  const [isExtractingFrames, setIsExtractingFrames] = useState(false);
  const [frameExtractionError, setFrameExtractionError] = useState<string | null>(null);
  const [preloadedVideoUrl, setPreloadedVideoUrl] = useState<string | null>(null); // Video URL downloaded for frame extraction
  const [isPreloadingVideo, setIsPreloadingVideo] = useState(false);

  // AI generation state (for from-video mode)
  const characterRefInputRef = useRef<HTMLInputElement>(null);
  const [characterRefFile, setCharacterRefFile] = useState<File | null>(null);
  const [characterRefPreview, setCharacterRefPreview] = useState<string | null>(null);
  const [characterRefPositionId, setCharacterRefPositionId] = useState<string | null>(null);
  const [positionGenPrompt, setPositionGenPrompt] = useState(DEFAULT_POSITION_PROMPT);
  const [isGeneratingPosition, setIsGeneratingPosition] = useState(false);
  const [generatedPositionUrl, setGeneratedPositionUrl] = useState<string | null>(null);
  const [positionGenError, setPositionGenError] = useState<string | null>(null);

  // Save generated position as reusable position
  const [savePositionName, setSavePositionName] = useState('');
  const [isSavingAsPosition, setIsSavingAsPosition] = useState(false);
  const [savedAsPositionId, setSavedAsPositionId] = useState<string | null>(null);

  // Video input options
  const [videoSource, setVideoSource] = useState<'upload' | 'youtube'>('upload');
  const [inputVideoUrl, setInputVideoUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Inline processing state
  type ProcessingStage = 'idle' | 'downloading' | 'submitting' | 'processing' | 'complete' | 'failed';
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('idle');
  const [processingMessage, setProcessingMessage] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [outputVideoUrl, setOutputVideoUrl] = useState<string | null>(null);
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string | null>(null); // The input video after download
  const [outputVideoDuration, setOutputVideoDuration] = useState<number>(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Filter positions by selected equipment
  const filteredPositions = useMemo(() => {
    return positions.filter(p => p.equipmentType === equipmentType);
  }, [positions, equipmentType]);

  // Load initial data when editing or re-running
  useEffect(() => {
    if (initialData && isOpen) {
      setExerciseName(initialData.exerciseName);
      setEquipmentType(initialData.equipmentType);
      setPositionId(initialData.positionId);
      setCustomPositionUrl(initialData.customPositionUrl || '');
      setCharacterOrientation(initialData.characterOrientation || 'video');
      setCustomPrompt(initialData.customPrompt || DEFAULT_PROMPT);

      if (initialData.youtubeUrl) {
        setVideoSource('youtube');
        setYoutubeUrl(initialData.youtubeUrl);
        setStartTime(initialData.startTime?.toString() || '');
        setEndTime(initialData.endTime?.toString() || '');
      } else if (initialData.inputVideoUrl) {
        setVideoSource('upload');
        setInputVideoUrl(initialData.inputVideoUrl);
        setStartTime(initialData.startTime?.toString() || '');
        setEndTime(initialData.endTime?.toString() || '');
      }
    }
  }, [initialData, isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Clear polling if active
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setTimeout(() => {
        setExerciseName('');
        setEquipmentType('Barbell');
        setPositionId('');
        setCustomPositionUrl('');
        setCharacterOrientation('video');
        setCustomPrompt(DEFAULT_PROMPT);
        setVideoSource('upload');
        setInputVideoUrl('');
        setYoutubeUrl('');
        setStartTime('');
        setEndTime('');
        setUploadError(null);
        // Reset processing state
        setProcessingStage('idle');
        setProcessingMessage('');
        setTaskId(null);
        setOutputVideoUrl(null);
        setProcessedVideoUrl(null);
        setOutputVideoDuration(0);
        // Reset from-video position generation state
        setPositionSourceMode('existing');
        setExtractedFrames([]);
        setSelectedFrameUrl(null);
        setIsExtractingFrames(false);
        setFrameExtractionError(null);
        setPreloadedVideoUrl(null);
        setIsPreloadingVideo(false);
        if (characterRefPreview) URL.revokeObjectURL(characterRefPreview);
        setCharacterRefFile(null);
        setCharacterRefPreview(null);
        setCharacterRefPositionId(null);
        setPositionGenPrompt(DEFAULT_POSITION_PROMPT);
        setIsGeneratingPosition(false);
        setIsUploadingGeneratedPosition(false);
        setGeneratedPositionUrl(null);
        setPositionGenError(null);
        setSavePositionName('');
        setIsSavingAsPosition(false);
        setSavedAsPositionId(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (positionImageInputRef.current) positionImageInputRef.current.value = '';
        if (characterRefInputRef.current) characterRefInputRef.current.value = '';
      }, 300);
    }
  }, [isOpen]);

  // Set first filtered position as default when equipment changes
  useEffect(() => {
    if (filteredPositions.length > 0 && !customPositionUrl) {
      // Only auto-select if current position doesn't match equipment
      const currentPositionMatchesEquipment = filteredPositions.some(p => p.id === positionId);
      if (!currentPositionMatchesEquipment) {
        setPositionId(filteredPositions[0].id);
      }
    }
  }, [filteredPositions, positionId, customPositionUrl]);

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'video');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setInputVideoUrl(data.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handlePositionImageUpload = async (file: File) => {
    setIsUploadingPosition(true);
    setUploadError(null);

    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const pathname = `images/position-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('videos')
        .upload(pathname, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(pathname);

      setCustomPositionUrl(urlData.publicUrl);
      setPositionId(''); // Clear preset position when custom is uploaded
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Position image upload failed');
    } finally {
      setIsUploadingPosition(false);
    }
  };

  const handlePositionImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePositionImageUpload(file);
  };

  // Frame extraction function
  const extractFramesFromVideo = useCallback(async (videoUrl: string): Promise<ExtractedFrame[]> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'auto';

      video.onloadedmetadata = async () => {
        const duration = video.duration;
        const interval = 0.5; // Extract frame every 0.5 seconds
        const maxFrames = 40;
        const frameTimes: number[] = [];

        // Calculate frame times
        for (let t = 0; t < duration && frameTimes.length < maxFrames; t += interval) {
          frameTimes.push(t);
        }

        const frames: ExtractedFrame[] = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Scale to max 360px height for thumbnails (smaller for grid display)
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

        // Extract frames sequentially (seeking requires sequential processing)
        for (const time of frameTimes) {
          try {
            const frame = await extractFrame(time);
            frames.push(frame);
          } catch {
            // Skip failed frames
          }
        }

        resolve(frames);
      };

      video.onerror = () => {
        reject(new Error('Failed to load video for frame extraction'));
      };

      video.src = videoUrl;
    });
  }, []);

  // Preload video and extract frames when "from-video" mode is selected
  const handlePreloadVideoAndExtractFrames = useCallback(async () => {
    setFrameExtractionError(null);
    setExtractedFrames([]);
    setSelectedFrameUrl(null);
    setGeneratedPositionUrl(null);

    // Determine the video source
    let videoUrlToUse = inputVideoUrl; // Use uploaded video if available

    if (videoSource === 'youtube' && youtubeUrl.trim()) {
      // Need to download YouTube video first
      setIsPreloadingVideo(true);
      try {
        const downloadRes = await fetch('/api/youtube-download-v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: youtubeUrl }),
        });

        if (!downloadRes.ok) {
          const err = await downloadRes.json();
          throw new Error(err.error || 'Failed to download YouTube video');
        }

        const downloadData = await downloadRes.json();
        videoUrlToUse = downloadData.url;
        setPreloadedVideoUrl(downloadData.url);
      } catch (err) {
        setFrameExtractionError(err instanceof Error ? err.message : 'Failed to download video');
        setIsPreloadingVideo(false);
        return;
      }
      setIsPreloadingVideo(false);
    } else if (!videoUrlToUse) {
      setFrameExtractionError('Please upload a video or enter a YouTube URL first');
      return;
    }

    // Extract frames from the video
    setIsExtractingFrames(true);
    try {
      const frames = await extractFramesFromVideo(videoUrlToUse);
      if (frames.length === 0) {
        throw new Error('Could not extract any frames from the video');
      }
      setExtractedFrames(frames);
    } catch (err) {
      setFrameExtractionError(err instanceof Error ? err.message : 'Failed to extract frames');
    } finally {
      setIsExtractingFrames(false);
    }
  }, [videoSource, youtubeUrl, inputVideoUrl, extractFramesFromVideo]);

  // Handle character reference file upload
  const handleCharacterRefSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (characterRefPreview) URL.revokeObjectURL(characterRefPreview);
      setCharacterRefFile(file);
      setCharacterRefPreview(URL.createObjectURL(file));
      setCharacterRefPositionId(null);
    }
  };

  // Handle character reference from existing position
  const handleCharacterRefFromPosition = (posId: string) => {
    if (characterRefPreview && characterRefFile) URL.revokeObjectURL(characterRefPreview);
    setCharacterRefFile(null);
    setCharacterRefPositionId(posId);
    const pos = positions.find(p => p.id === posId);
    setCharacterRefPreview(pos?.publicUrl || null);
  };

  // Generate position image using AI
  const handleGeneratePositionImage = async () => {
    if (!selectedFrameUrl || !characterRefPreview) {
      setPositionGenError('Please select both a frame and a character reference');
      return;
    }

    setIsGeneratingPosition(true);
    setPositionGenError(null);
    setGeneratedPositionUrl(null);

    try {
      // Prepare character reference data
      let characterRefData: string;
      if (characterRefFile) {
        characterRefData = await fileToBase64(characterRefFile);
      } else if (characterRefPositionId) {
        const pos = positions.find(p => p.id === characterRefPositionId);
        characterRefData = pos?.publicUrl || '';
      } else {
        throw new Error('Character reference is required');
      }

      // The selected frame is already a base64 data URL
      const poseRefData = selectedFrameUrl;

      const response = await fetch('/api/generate-position-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImage1: characterRefData,
          referenceImage2: poseRefData,
          prompt: positionGenPrompt,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate image');
      }

      setGeneratedPositionUrl(data.imageUrl);
    } catch (err) {
      setPositionGenError(err instanceof Error ? err.message : 'Failed to generate position');
    } finally {
      setIsGeneratingPosition(false);
    }
  };

  // Use the generated position image - upload to storage first
  const handleUseGeneratedPosition = async () => {
    if (!generatedPositionUrl) return;

    setIsUploadingGeneratedPosition(true);
    setPositionGenError(null);

    try {
      // Convert base64 data URL to Blob
      const blob = base64ToBlob(generatedPositionUrl);

      // Create a File from the Blob
      const file = new File([blob], `generated-position-${Date.now()}.png`, { type: blob.type });

      // Upload via /api/upload
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'image');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      // Set the uploaded URL (not the base64)
      setCustomPositionUrl(data.url);
      setPositionId(''); // Clear preset position
      setGeneratedPositionUrl(null); // Clear the base64 version
    } catch (err) {
      setPositionGenError(err instanceof Error ? err.message : 'Failed to upload generated image');
    } finally {
      setIsUploadingGeneratedPosition(false);
    }
  };

  // Save the generated position as a reusable position
  const handleSaveAsPosition = async () => {
    if (!customPositionUrl || !savePositionName.trim()) {
      setPositionGenError('Please enter a position name');
      return;
    }

    setIsSavingAsPosition(true);
    setPositionGenError(null);

    try {
      // Fetch the image from the URL and convert to File
      const response = await fetch(customPositionUrl);
      const blob = await response.blob();
      const file = new File([blob], `position-${Date.now()}.png`, { type: blob.type || 'image/png' });

      // Create the position using the hook
      const newPosition = await createPosition(savePositionName.trim(), equipmentType, file);

      // Mark as saved and set the position ID
      setSavedAsPositionId(newPosition.id);
      setPositionId(newPosition.id); // Also set this position as the selected one
    } catch (err) {
      setPositionGenError(err instanceof Error ? err.message : 'Failed to save position');
    } finally {
      setIsSavingAsPosition(false);
    }
  };

  const handleSave = () => {
    // Validation
    if (!exerciseName.trim()) {
      setUploadError('Exercise name is required');
      return;
    }

    if (videoSource === 'upload' && !inputVideoUrl) {
      setUploadError('Please upload a video');
      return;
    }

    if (videoSource === 'youtube' && !youtubeUrl.trim()) {
      setUploadError('Please enter a YouTube URL');
      return;
    }

    // Position validation based on mode
    if (positionSourceMode === 'existing' && !positionId) {
      setUploadError('Please select a position');
      return;
    }
    if (positionSourceMode === 'upload' && !customPositionUrl) {
      setUploadError('Please upload a position image');
      return;
    }
    if (positionSourceMode === 'from-video' && !customPositionUrl && !generatedPositionUrl) {
      setUploadError('Please generate a position image from the video');
      return;
    }

    // Use generatedPositionUrl if customPositionUrl isn't set (for from-video mode)
    const finalCustomPositionUrl = customPositionUrl || generatedPositionUrl || undefined;

    const selectedPosition = positionId ? positions.find((p) => p.id === positionId) : null;

    // Build template
    const template: Omit<ExerciseTemplate, 'id' | 'createdAt'> = {
      exerciseName: exerciseName.trim(),
      equipmentType,
      positionId: positionId || 'custom',
      positionName: selectedPosition?.name || 'Custom',
      customPositionUrl: finalCustomPositionUrl,
      customPrompt: customPrompt.trim() || DEFAULT_PROMPT,
      characterOrientation,
      inputVideoUrl: videoSource === 'upload' ? inputVideoUrl : undefined,
      youtubeUrl: videoSource === 'youtube' ? youtubeUrl.trim() : undefined,
      startTime: startTime.trim() ? parseFloat(startTime) : undefined,
      endTime: endTime.trim() ? parseFloat(endTime) : undefined,
    };

    onSave(template);
    onClose();
  };

  // Run Now - Process inline without adding to queue
  const handleRunNow = async () => {
    // Validation
    if (!exerciseName.trim()) {
      setUploadError('Exercise name is required');
      return;
    }

    if (videoSource === 'upload' && !inputVideoUrl) {
      setUploadError('Please upload a video');
      return;
    }

    if (videoSource === 'youtube' && !youtubeUrl.trim()) {
      setUploadError('Please enter a YouTube URL');
      return;
    }

    // Position validation based on mode
    if (positionSourceMode === 'existing' && !positionId) {
      setUploadError('Please select a position');
      return;
    }
    if (positionSourceMode === 'upload' && !customPositionUrl) {
      setUploadError('Please upload a position image');
      return;
    }
    if (positionSourceMode === 'from-video' && !customPositionUrl && !generatedPositionUrl) {
      setUploadError('Please generate a position image from the video');
      return;
    }

    setUploadError(null);
    setProcessingStage('downloading');
    setProcessingMessage('Preparing video...');

    try {
      let videoUrl = inputVideoUrl;

      // Step 1: Download YouTube video if needed (or use preloaded one from frame extraction)
      if (videoSource === 'youtube') {
        if (preloadedVideoUrl) {
          // We already downloaded the video for frame extraction
          videoUrl = preloadedVideoUrl;
        } else {
          setProcessingMessage('Downloading YouTube video (this may take up to 60s)...');
          const downloadRes = await fetch('/api/youtube-download-v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: youtubeUrl,
            }),
          });

          if (!downloadRes.ok) {
            const err = await downloadRes.json();
            throw new Error(err.error || 'Failed to download YouTube video');
          }

          const downloadData = await downloadRes.json();
          videoUrl = downloadData.url;
        }
      }

      // Step 2: Trim video if timestamps are specified
      const trimStart = startTime.trim() ? parseFloat(startTime) : undefined;
      const trimEnd = endTime.trim() ? parseFloat(endTime) : undefined;

      if (trimStart !== undefined || trimEnd !== undefined) {
        setProcessingMessage('Trimming video...');

        // Get video duration if end time not specified
        let actualEndTime = trimEnd;
        if (actualEndTime === undefined) {
          const duration = await getVideoDuration(videoUrl);
          if (duration) {
            actualEndTime = duration;
          } else {
            throw new Error('Could not determine video duration for trimming');
          }
        }

        const actualStartTime = trimStart ?? 0;
        console.log(`[Trim] Trimming video from ${actualStartTime}s to ${actualEndTime}s`);

        try {
          const trimmedBlob = await trimVideo(videoUrl, actualStartTime, actualEndTime);
          console.log(`[Trim] Trimmed to ${(trimmedBlob.size / 1024 / 1024).toFixed(2)} MB`);

          // Upload trimmed video
          setProcessingMessage('Uploading trimmed video...');
          const formData = new FormData();
          formData.append('file', trimmedBlob, `trimmed-${Date.now()}.mp4`);
          formData.append('type', 'video');

          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          });

          if (!uploadRes.ok) {
            const err = await uploadRes.json();
            throw new Error(err.error || 'Failed to upload trimmed video');
          }

          const uploadData = await uploadRes.json();
          videoUrl = uploadData.url;
          console.log(`[Trim] Uploaded trimmed video: ${videoUrl}`);
        } catch (trimError) {
          console.error('[Trim] Trimming failed:', trimError);
          throw new Error(`Video trimming failed: ${trimError instanceof Error ? trimError.message : 'Unknown error'}`);
        }
      }

      setProcessedVideoUrl(videoUrl);

      // Step 3: Get position image URL
      const positionImageUrl = customPositionUrl || generatedPositionUrl || positions.find(p => p.id === positionId)?.publicUrl;
      if (!positionImageUrl) {
        throw new Error('Position image not found');
      }

      // Step 4: Submit to Kling API
      setProcessingStage('submitting');
      setProcessingMessage('Submitting to Kling AI...');

      const processRes = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: positionImageUrl,
          videoUrl,
          characterOrientation,
          mode: 'std',
          keepOriginalSound: 'no',
          prompt: customPrompt,
        }),
      });

      if (!processRes.ok) {
        const err = await processRes.json();
        throw new Error(err.error || 'Failed to submit to Kling API');
      }

      const processData = await processRes.json();
      setTaskId(processData.taskId);

      // Step 4: Poll for completion
      setProcessingStage('processing');
      setProcessingMessage('Processing video... This may take a few minutes.');

      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/process/${processData.taskId}`);
          if (!statusRes.ok) {
            throw new Error('Failed to check status');
          }

          const statusData = await statusRes.json();

          if (statusData.status === 'succeed') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            setOutputVideoUrl(statusData.videos?.[0]?.url || null);
            setProcessingStage('complete');
            setProcessingMessage('Video generation complete!');
          } else if (statusData.status === 'failed') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            throw new Error(statusData.statusMessage || 'Video generation failed');
          } else {
            setProcessingMessage(`Processing... Status: ${statusData.status}`);
          }
        } catch (pollError) {
          console.error('Polling error:', pollError);
        }
      }, 10000); // Poll every 10 seconds

    } catch (error) {
      console.error('Processing error:', error);
      setProcessingStage('failed');
      setProcessingMessage(error instanceof Error ? error.message : 'Processing failed');
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
  };

  // Reset to try again
  const handleRetry = () => {
    setProcessingStage('idle');
    setProcessingMessage('');
    setTaskId(null);
    setOutputVideoUrl(null);
    setProcessedVideoUrl(null);
  };

  if (!isOpen) return null;

  const modalTitle = mode === 'create' ? 'Create Exercise Template' : 'Edit Exercise Template';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">{modalTitle}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Exercise Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Exercise Name *
            </label>
            <input
              type="text"
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              placeholder="e.g., Barbell Squat"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Video Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Video Input *
            </label>

            {/* Video Source Toggle */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setVideoSource('upload')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  videoSource === 'upload'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Upload MP4
              </button>
              <button
                onClick={() => setVideoSource('youtube')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  videoSource === 'youtube'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                YouTube URL
              </button>
            </div>

            {videoSource === 'upload' ? (
              <div>
                {inputVideoUrl ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-gray-300 overflow-hidden">
                      <video src={inputVideoUrl} controls className="w-full max-h-48" />
                    </div>
                    <button
                      onClick={() => {
                        setInputVideoUrl('');
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Remove video
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/mp4,video/quicktime"
                      onChange={handleFileSelect}
                      disabled={isUploading}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="w-full py-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors disabled:opacity-50"
                    >
                      {isUploading ? (
                        <div className="text-center">
                          <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                          <p className="text-sm text-gray-500">Uploading...</p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <p className="text-sm font-medium text-gray-700">Click to upload MP4</p>
                          <p className="text-xs text-gray-400 mt-1">Max 100MB</p>
                        </div>
                      )}
                    </button>
                  </div>
                )}

                {/* Trim Timestamps for uploaded videos */}
                {inputVideoUrl && (
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mt-3">
                    <p className="text-xs font-medium text-gray-700 mb-2">Trim Timestamps (optional)</p>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-600 mb-1">Start (seconds)</label>
                        <input
                          type="number"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          placeholder="0"
                          min="0"
                          step="0.1"
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-600 mb-1">End (seconds)</label>
                        <input
                          type="number"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          placeholder="auto"
                          min="0"
                          step="0.1"
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />

                {/* Trim Timestamps */}
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs font-medium text-gray-700 mb-2">Custom Timestamps (optional)</p>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 mb-1">Start (seconds)</label>
                      <input
                        type="number"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        placeholder="0"
                        min="0"
                        step="0.1"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 mb-1">End (seconds)</label>
                      <input
                        type="number"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        placeholder="auto"
                        min="0"
                        step="0.1"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Equipment Type - FIRST */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Equipment *
            </label>
            <select
              value={equipmentType}
              onChange={(e) => {
                setEquipmentType(e.target.value);
                // Clear custom position when equipment changes
                if (customPositionUrl) {
                  setCustomPositionUrl('');
                  if (positionImageInputRef.current) positionImageInputRef.current.value = '';
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {allEquipmentNames.map((eq) => (
                <option key={eq} value={eq}>
                  {eq}
                </option>
              ))}
            </select>
          </div>

          {/* Position Selection - Three Mode Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Position *
            </label>

            {/* Position Source Mode Toggle */}
            <div className="flex gap-1 mb-3 p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setPositionSourceMode('existing');
                  setCustomPositionUrl('');
                  setGeneratedPositionUrl(null);
                }}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  positionSourceMode === 'existing'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Existing
              </button>
              <button
                type="button"
                onClick={() => {
                  setPositionSourceMode('upload');
                  setPositionId('');
                  setGeneratedPositionUrl(null);
                }}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  positionSourceMode === 'upload'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Upload
              </button>
              <button
                type="button"
                onClick={() => {
                  setPositionSourceMode('from-video');
                  setPositionId('');
                  setCustomPositionUrl('');
                }}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  positionSourceMode === 'from-video'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                From Video
              </button>
            </div>

            {/* EXISTING MODE */}
            {positionSourceMode === 'existing' && (
              <select
                value={positionId}
                onChange={(e) => setPositionId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {filteredPositions.length === 0 && (
                  <option value="">No positions for {equipmentType}</option>
                )}
                {filteredPositions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name}
                  </option>
                ))}
              </select>
            )}

            {/* UPLOAD MODE */}
            {positionSourceMode === 'upload' && (
              <div>
                {customPositionUrl ? (
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3">
                      <img
                        src={customPositionUrl}
                        alt="Custom position"
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700">Custom Position Image</p>
                        <button
                          onClick={() => {
                            setCustomPositionUrl('');
                            if (positionImageInputRef.current) positionImageInputRef.current.value = '';
                          }}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      ref={positionImageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handlePositionImageSelect}
                      disabled={isUploadingPosition}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => positionImageInputRef.current?.click()}
                      disabled={isUploadingPosition}
                      className="w-full py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
                    >
                      {isUploadingPosition ? (
                        <div className="flex flex-col items-center">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mb-2" />
                          <p className="text-sm text-gray-500">Uploading...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <svg className="w-6 h-6 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-sm font-medium text-gray-700">Click to upload position image</p>
                        </div>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* FROM VIDEO MODE */}
            {positionSourceMode === 'from-video' && (
              <div className="space-y-4">
                {/* Generated position preview (if we have one, show it at top) */}
                {(customPositionUrl || generatedPositionUrl) && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-3">
                      <img
                        src={customPositionUrl || generatedPositionUrl!}
                        alt="Generated position"
                        className="w-20 h-20 object-cover rounded-lg border-2 border-green-400"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-700">✓ Position Ready</p>
                        <p className="text-xs text-green-600">This will be used for video generation</p>
                        <button
                          onClick={() => {
                            setCustomPositionUrl('');
                            setGeneratedPositionUrl(null);
                            setSavedAsPositionId(null);
                            setSavePositionName('');
                          }}
                          className="text-xs text-red-600 hover:text-red-700 mt-1"
                        >
                          Remove & Start Over
                        </button>
                      </div>
                    </div>

                    {/* Save as Position Option */}
                    {savedAsPositionId ? (
                      <div className="mt-3 pt-3 border-t border-green-200">
                        <p className="text-xs font-medium text-green-700">
                          ✓ Saved as position: {savePositionName}
                        </p>
                        <p className="text-xs text-green-600">Available for future exercises</p>
                      </div>
                    ) : (
                      <div className="mt-3 pt-3 border-t border-green-200">
                        <p className="text-xs font-medium text-gray-700 mb-2">Save as reusable position?</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={savePositionName}
                            onChange={(e) => setSavePositionName(e.target.value)}
                            placeholder="Position name"
                            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                          />
                          <button
                            type="button"
                            onClick={handleSaveAsPosition}
                            disabled={!savePositionName.trim() || isSavingAsPosition}
                            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            {isSavingAsPosition ? (
                              <span className="flex items-center gap-1">
                                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                Saving...
                              </span>
                            ) : (
                              'Save Position'
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Equipment: {equipmentType}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 1: Load frames from video */}
                {!customPositionUrl && !generatedPositionUrl && extractedFrames.length === 0 && (
                  <div className="text-center py-4">
                    {isPreloadingVideo || isExtractingFrames ? (
                      <div>
                        <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-blue-500 border-t-transparent mb-3" />
                        <p className="text-sm text-gray-600">
                          {isPreloadingVideo ? 'Downloading video...' : 'Extracting frames...'}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-gray-600 mb-3">
                          Extract frames from your video to select a pose reference
                        </p>
                        <button
                          type="button"
                          onClick={handlePreloadVideoAndExtractFrames}
                          disabled={!inputVideoUrl && !youtubeUrl.trim()}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          Load Video Frames
                        </button>
                        {(!inputVideoUrl && !youtubeUrl.trim()) && (
                          <p className="text-xs text-gray-500 mt-2">Please add a video first</p>
                        )}
                      </div>
                    )}
                    {frameExtractionError && (
                      <p className="text-sm text-red-600 mt-2">{frameExtractionError}</p>
                    )}
                  </div>
                )}

                {/* Step 2: Frame selector grid */}
                {!customPositionUrl && !generatedPositionUrl && extractedFrames.length > 0 && !selectedFrameUrl && (
                  <div>
                    <p className="text-xs font-medium text-gray-700 mb-2">Select a frame as pose reference:</p>
                    <div className="grid grid-cols-5 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-lg border border-gray-200">
                      {extractedFrames.map((frame, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedFrameUrl(frame.dataUrl)}
                          className="aspect-video rounded overflow-hidden border-2 border-transparent hover:border-blue-400 focus:border-blue-500 focus:outline-none transition-colors"
                        >
                          <img
                            src={frame.dataUrl}
                            alt={`Frame at ${frame.time.toFixed(1)}s`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{extractedFrames.length} frames extracted</p>
                  </div>
                )}

                {/* Step 3: AI Generation UI (after frame is selected) */}
                {!customPositionUrl && !generatedPositionUrl && selectedFrameUrl && (
                  <div className="space-y-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="flex items-start gap-3">
                      {/* Selected Frame Preview */}
                      <div className="flex-shrink-0">
                        <p className="text-xs font-medium text-gray-600 mb-1">Pose</p>
                        <div className="relative">
                          <img
                            src={selectedFrameUrl}
                            alt="Selected pose"
                            className="w-20 h-16 object-cover rounded border-2 border-purple-400"
                          />
                          <button
                            type="button"
                            onClick={() => setSelectedFrameUrl(null)}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      {/* Character Reference */}
                      <div className="flex-1">
                        <p className="text-xs font-medium text-gray-600 mb-1">Character (Avatar)</p>
                        {characterRefPreview ? (
                          <div className="flex items-center gap-2">
                            <img
                              src={characterRefPreview}
                              alt="Character reference"
                              className="w-16 h-16 object-cover rounded border"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (characterRefPreview && characterRefFile) URL.revokeObjectURL(characterRefPreview);
                                setCharacterRefFile(null);
                                setCharacterRefPreview(null);
                                setCharacterRefPositionId(null);
                              }}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              ref={characterRefInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={handleCharacterRefSelect}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => characterRefInputRef.current?.click()}
                              className="px-2 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            >
                              Upload
                            </button>
                            <select
                              value={characterRefPositionId || ''}
                              onChange={(e) => e.target.value && handleCharacterRefFromPosition(e.target.value)}
                              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
                            >
                              <option value="">Select existing...</option>
                              {positions.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Prompt */}
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1">Generation Prompt</p>
                      <textarea
                        value={positionGenPrompt}
                        onChange={(e) => setPositionGenPrompt(e.target.value)}
                        rows={2}
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>

                    {/* Generate Button */}
                    <button
                      type="button"
                      onClick={handleGeneratePositionImage}
                      disabled={!characterRefPreview || isGeneratingPosition}
                      className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isGeneratingPosition ? (
                        <span className="flex items-center justify-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Generating...
                        </span>
                      ) : (
                        'Generate Position Image'
                      )}
                    </button>

                    {positionGenError && (
                      <p className="text-xs text-red-600">{positionGenError}</p>
                    )}
                  </div>
                )}

                {/* Generated Result (waiting for confirmation) */}
                {!customPositionUrl && generatedPositionUrl && (
                  <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <p className="text-xs font-medium text-purple-700 mb-2">Generated Position</p>
                    <div className="flex items-start gap-3">
                      <img
                        src={generatedPositionUrl}
                        alt="Generated position"
                        className="w-28 h-36 object-cover rounded-lg border"
                      />
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={handleUseGeneratedPosition}
                          disabled={isUploadingGeneratedPosition}
                          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          {isUploadingGeneratedPosition ? (
                            <span className="flex items-center gap-1">
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              Saving...
                            </span>
                          ) : (
                            '✓ Use This'
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setGeneratedPositionUrl(null)}
                          disabled={isUploadingGeneratedPosition}
                          className="px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Edit & Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setGeneratedPositionUrl(null);
                            setSelectedFrameUrl(null);
                          }}
                          disabled={isUploadingGeneratedPosition}
                          className="px-3 py-1.5 text-xs text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Pick Different Frame
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Character Orientation - For Testing */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Character Orientation
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCharacterOrientation('video')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  characterOrientation === 'video'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Video (Exact)
              </button>
              <button
                type="button"
                onClick={() => setCharacterOrientation('image')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  characterOrientation === 'image'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Image
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {characterOrientation === 'video'
                ? 'Matches camera movement and character facing from motion reference (max 30s)'
                : 'Preserves image composition while applying motion (max 10s)'}
            </p>
          </div>

          {/* Custom Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Special Prompt
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={4}
              placeholder="Custom instructions for the AI..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              This will be used to guide the AI when generating the video
            </p>
          </div>

          {/* Error Message */}
          {uploadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{uploadError}</p>
            </div>
          )}

          {/* Processing UI */}
          {processingStage !== 'idle' && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              {/* Processing/Downloading/Submitting */}
              {(processingStage === 'downloading' || processingStage === 'submitting' || processingStage === 'processing') && (
                <div className="text-center">
                  <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-3 border-blue-500 border-t-transparent" />
                  <p className="text-sm font-medium text-gray-700">{processingMessage}</p>
                  {processingStage === 'processing' && (
                    <p className="text-xs text-gray-500 mt-1">This typically takes 3-5 minutes</p>
                  )}
                </div>
              )}

              {/* Complete */}
              {processingStage === 'complete' && outputVideoUrl && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                      <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-green-700">Video Generated!</p>
                  </div>
                  <video
                    src={outputVideoUrl}
                    controls
                    autoPlay
                    loop
                    muted
                    className="w-full rounded-lg border border-gray-200 mb-3"
                    style={{ maxHeight: '300px' }}
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget;
                      setOutputVideoDuration(video.duration);
                    }}
                  />
                </div>
              )}

              {/* Failed */}
              {processingStage === 'failed' && (
                <div className="text-center">
                  <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-red-700">Processing Failed</p>
                  <p className="text-xs text-red-600 mt-1">{processingMessage}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex gap-3 border-t border-gray-200">
          {processingStage === 'idle' ? (
            <>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isUploading || isUploadingPosition || isUploadingGeneratedPosition}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Save to Pending
              </button>
              <button
                onClick={handleRunNow}
                disabled={isUploading || isUploadingPosition || isUploadingGeneratedPosition}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Run Now
              </button>
            </>
          ) : processingStage === 'complete' ? (
            <>
              <button
                onClick={handleRetry}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={async () => {
                  if (!onSaveToLibrary || !outputVideoUrl) {
                    setUploadError('Cannot save: missing video URL or save function');
                    return;
                  }

                  try {
                    const selectedPosition = positionId ? positions.find(p => p.id === positionId) : null;
                    const costPerSecond = 0.07; // Standard mode cost
                    const costUsd = Math.round(outputVideoDuration * costPerSecond * 100) / 100;

                    await onSaveToLibrary({
                      exerciseName: exerciseName.trim(),
                      equipmentType,
                      outputVideoUrl,
                      inputVideoUrl: processedVideoUrl || inputVideoUrl,
                      positionId: positionId || 'custom',
                      positionName: selectedPosition?.name || 'Custom',
                      mode: 'std',
                      costUsd,
                      customPrompt: customPrompt.trim() || undefined,
                    });
                    onClose();
                  } catch (err) {
                    console.error('Save to library error:', err);
                    setUploadError(err instanceof Error ? err.message : 'Failed to save to library');
                  }
                }}
                disabled={!onSaveToLibrary}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Save to Library
              </button>
            </>
          ) : processingStage === 'failed' ? (
            <>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRetry}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            </>
          ) : (
            <p className="w-full text-center text-sm text-gray-500">
              Processing in progress... Please wait.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
