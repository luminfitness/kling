'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { ExerciseEntry } from '@/types';

interface AlphaChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  exercises: ExerciseEntry[];
}

type OutputFormat = 'webm' | 'mov';

export default function AlphaChannelModal({
  isOpen,
  onClose,
  exercises,
}: AlphaChannelModalProps) {
  const [sourceType, setSourceType] = useState<'upload' | 'library'>('upload');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('webm');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load FFmpeg on mount
  useEffect(() => {
    if (!isOpen) return;

    const loadFFmpeg = async () => {
      if (ffmpegRef.current) {
        setFfmpegLoaded(true);
        return;
      }

      try {
        setProgressMessage('Loading FFmpeg...');
        setError(null);
        const ffmpeg = new FFmpeg();

        ffmpeg.on('progress', ({ progress }) => {
          setProgress(Math.round(progress * 100));
          setProgressMessage(`Processing: ${Math.round(progress * 100)}%`);
        });

        ffmpeg.on('log', ({ message }) => {
          console.log('[FFmpeg]', message);
        });

        // Load FFmpeg WASM from jsdelivr CDN (more reliable CORS)
        const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
        await ffmpeg.load({
          coreURL: `${baseURL}/ffmpeg-core.js`,
          wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });

        ffmpegRef.current = ffmpeg;
        setFfmpegLoaded(true);
        setProgressMessage('');
      } catch (err) {
        console.error('Failed to load FFmpeg:', err);
        setError(`Failed to load FFmpeg: ${err instanceof Error ? err.message : 'Unknown error'}. Try refreshing the page.`);
        setProgressMessage('');
      }
    };

    loadFFmpeg();
  }, [isOpen]);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      setUploadedFile(null);
      setSelectedExerciseId('');
      setProgress(0);
      setProgressMessage('');
      setOutputUrl(null);
      setError(null);
    }
  }, [isOpen]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      setUploadedFile(file);
      setSourceType('upload');
      setError(null);
    } else {
      setError('Please drop a video file (MP4, WebM, etc.)');
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setSourceType('upload');
      setError(null);
    }
  }, []);

  const handleProcess = async () => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) {
      setError('FFmpeg not loaded');
      return;
    }

    // Get input video
    let inputData: Uint8Array;
    let inputFilename = 'input.mp4';

    try {
      setProcessing(true);
      setProgress(0);
      setError(null);
      setOutputUrl(null);

      if (sourceType === 'upload' && uploadedFile) {
        setProgressMessage('Reading uploaded file...');
        inputData = new Uint8Array(await uploadedFile.arrayBuffer());
      } else if (sourceType === 'library' && selectedExerciseId) {
        const exercise = exercises.find((e) => e.id === selectedExerciseId);
        if (!exercise?.outputVideoUrl) {
          throw new Error('No video URL found for selected exercise');
        }
        setProgressMessage('Downloading video...');
        inputData = await fetchFile(exercise.outputVideoUrl);
      } else {
        throw new Error('Please select a video source');
      }

      // Write input file
      setProgressMessage('Preparing video...');
      await ffmpeg.writeFile(inputFilename, inputData);

      // Process based on output format
      const outputFilename = outputFormat === 'webm' ? 'output.webm' : 'output.mov';

      setProgressMessage('Removing green screen...');

      try {
        let exitCode: number;

        if (outputFormat === 'webm') {
          // WebM with VP8 for alpha channel
          // chromakey filter: color (green), similarity (0.15), blend (0.1)
          // Use scale with expression for 720p max height
          exitCode = await ffmpeg.exec([
            '-i', inputFilename,
            '-vf', 'scale=iw*min(1\\,720/ih):ih*min(1\\,720/ih),chromakey=0x00FF00:0.15:0.1',
            '-c:v', 'libvpx',
            '-pix_fmt', 'yuva420p',
            '-auto-alt-ref', '0',
            '-b:v', '2M',
            '-an',
            '-y',
            outputFilename,
          ]);
        } else {
          // MOV with PNG codec for alpha
          exitCode = await ffmpeg.exec([
            '-i', inputFilename,
            '-vf', 'scale=iw*min(1\\,720/ih):ih*min(1\\,720/ih),chromakey=0x00FF00:0.15:0.1',
            '-c:v', 'png',
            '-pix_fmt', 'rgba',
            '-an',
            '-y',
            outputFilename,
          ]);
        }

        console.log('[FFmpeg] Exit code:', exitCode);

        if (exitCode !== 0) {
          throw new Error(`FFmpeg exited with code ${exitCode}. The codec may not be supported.`);
        }
      } catch (ffmpegError) {
        console.error('FFmpeg processing error:', ffmpegError);
        throw new Error('Video processing failed. Try a shorter video or use MOV format which uses less memory.');
      }

      // Read output
      setProgressMessage('Finalizing...');
      const data = await ffmpeg.readFile(outputFilename);

      // Check if we got actual data
      if (!(data instanceof Uint8Array) || data.length === 0) {
        console.error('[FFmpeg] Output file is empty or invalid');
        throw new Error('Video encoding failed - output is empty. The WebM codec may not be supported. Try MOV format instead.');
      }

      console.log(`[FFmpeg] Output file size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

      // Convert to ArrayBuffer to satisfy TypeScript
      const binaryData = new Uint8Array(data).buffer;
      const blob = new Blob([binaryData], {
        type: outputFormat === 'webm' ? 'video/webm' : 'video/quicktime'
      });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setProgressMessage('Complete!');
      setProgress(100);

      // Cleanup
      await ffmpeg.deleteFile(inputFilename);
      await ffmpeg.deleteFile(outputFilename);

    } catch (err) {
      console.error('Processing error:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
      setProgressMessage('');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!outputUrl) return;

    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = `alpha-video.${outputFormat}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const selectedExercise = exercises.find((e) => e.id === selectedExerciseId);
  const canProcess = ffmpegLoaded && !processing && (
    (sourceType === 'upload' && uploadedFile) ||
    (sourceType === 'library' && selectedExerciseId)
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-bold text-gray-900 mb-1">Alpha Channel Converter</h2>
        <p className="text-sm text-gray-500 mb-6">
          Remove green screen and create a video with transparent background
        </p>

        {/* Source Selection Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSourceType('upload')}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              sourceType === 'upload'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Upload Video
          </button>
          <button
            onClick={() => setSourceType('library')}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              sourceType === 'library'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            From Library
          </button>
        </div>

        {/* Upload Zone */}
        {sourceType === 'upload' && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : uploadedFile
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            {uploadedFile ? (
              <div className="flex flex-col items-center gap-2">
                <svg className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                <p className="text-sm text-gray-500">
                  {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setUploadedFile(null);
                  }}
                  className="mt-2 text-sm text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p className="font-medium text-gray-700">Drop video here or click to upload</p>
                <p className="text-sm text-gray-500">MP4, WebM, or other video formats</p>
              </div>
            )}
          </div>
        )}

        {/* Library Selection */}
        {sourceType === 'library' && (
          <div className="rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select from completed exercises
            </label>
            <select
              value={selectedExerciseId}
              onChange={(e) => setSelectedExerciseId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">-- Select an exercise --</option>
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.exerciseName} ({ex.equipmentType})
                </option>
              ))}
            </select>

            {selectedExercise?.outputVideoUrl && (
              <div className="mt-4">
                <video
                  src={selectedExercise.outputVideoUrl}
                  className="w-full max-h-48 rounded-lg bg-black object-contain"
                  controls
                />
              </div>
            )}
          </div>
        )}

        {/* Output Format */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Output Format
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setOutputFormat('webm')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                outputFormat === 'webm'
                  ? 'bg-purple-100 text-purple-700 ring-2 ring-purple-500'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <div className="font-semibold">WebM (VP9)</div>
              <div className="text-xs opacity-75 mt-0.5">Best for web, smaller files</div>
            </button>
            <button
              onClick={() => setOutputFormat('mov')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                outputFormat === 'mov'
                  ? 'bg-purple-100 text-purple-700 ring-2 ring-purple-500'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <div className="font-semibold">MOV (Animation)</div>
              <div className="text-xs opacity-75 mt-0.5">For video editors</div>
            </button>
          </div>
        </div>

        {/* Progress */}
        {(processing || progressMessage) && (
          <div className="mt-4 rounded-lg bg-blue-50 p-4">
            <div className="flex items-center gap-3">
              {processing && (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
              )}
              <span className="text-sm font-medium text-blue-700">{progressMessage}</span>
            </div>
            {progress > 0 && (
              <div className="mt-2 h-2 w-full rounded-full bg-blue-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Output Preview */}
        {outputUrl && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-700 mb-3">Output Ready!</p>
            <div className="relative rounded-lg overflow-hidden bg-checkerboard">
              <video
                src={outputUrl}
                className="w-full max-h-64 object-contain"
                controls
                autoPlay
                loop
                muted
              />
            </div>
            <button
              onClick={handleDownload}
              className="mt-3 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Download {outputFormat.toUpperCase()}
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
          <button
            onClick={handleProcess}
            disabled={!canProcess}
            className={`rounded-lg px-6 py-2 text-sm font-medium transition-colors ${
              canProcess
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {processing ? 'Processing...' : 'Remove Green Screen'}
          </button>
        </div>
      </div>

      {/* CSS for checkerboard pattern (shows transparency) */}
      <style jsx>{`
        .bg-checkerboard {
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%),
            linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%),
            linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
          background-color: #fff;
        }
      `}</style>
    </div>
  );
}
