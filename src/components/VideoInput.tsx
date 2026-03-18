'use client';

import { useState, useRef, useCallback } from 'react';

interface VideoInputProps {
  onVideoReady: (videoUrl: string) => void;
}

export default function VideoInput({ onVideoReady }: VideoInputProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [downloadingYoutube, setDownloadingYoutube] = useState(false);
  const [showTimestampInputs, setShowTimestampInputs] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError(null);

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

      setPreviewUrl(data.url);
      onVideoReady(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file && (file.type === 'video/mp4' || file.type === 'video/quicktime')) {
        uploadFile(file);
      } else {
        setError('Please drop an MP4 or MOV file');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleClear = () => {
    setPreviewUrl(null);
    setError(null);
    setYoutubeUrl('');
    setShowTimestampInputs(false);
    setStartTime('');
    setEndTime('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadFromYoutube = async () => {
    if (!youtubeUrl.trim()) return;

    // Validate timestamps if provided
    const start = startTime.trim() ? parseFloat(startTime) : undefined;
    const end = endTime.trim() ? parseFloat(endTime) : undefined;

    if (start !== undefined && isNaN(start)) {
      setError('Invalid start time. Please enter a number.');
      return;
    }

    if (end !== undefined && isNaN(end)) {
      setError('Invalid end time. Please enter a number.');
      return;
    }

    if (start !== undefined && end !== undefined && end <= start) {
      setError('End time must be greater than start time.');
      return;
    }

    setDownloadingYoutube(true);
    setError(null);

    try {
      // Server-side download: handles polling and upload in one request
      const res = await fetch('/api/youtube-download-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: youtubeUrl.trim(),
          startTime: start,
          endTime: end,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to download video from YouTube');

      // Video is already uploaded to Vercel Blob (trimmed if timestamps provided)
      setPreviewUrl(data.url);
      onVideoReady(data.url);
      setYoutubeUrl(''); // Clear input on success
      setStartTime('');
      setEndTime('');
      setShowTimestampInputs(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'YouTube download failed');
    } finally {
      setDownloadingYoutube(false);
    }
  };


  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Video Input</h2>
        {previewUrl && (
          <button
            onClick={handleClear}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {previewUrl ? (
        <div className="overflow-hidden rounded-xl border bg-black">
          <video
            src={previewUrl}
            controls
            className="mx-auto max-h-64 w-full"
          />
          <div className="bg-green-50 px-3 py-2 text-center text-sm text-green-700">
            Video ready
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${
            dragActive
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          {isUploading ? (
            <div className="text-center">
              <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <p className="text-sm text-gray-500">Uploading...</p>
            </div>
          ) : (
            <>
              <p className="mb-1 text-sm font-medium text-gray-700">
                Drop your MP4 here or click to browse
              </p>
              <p className="text-xs text-gray-400">
                MP4 or MOV, max 100MB
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}

      {/* YouTube URL Section */}
      {!previewUrl && (
        <>
          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-4 text-gray-500">Or</span>
            </div>
          </div>

          {/* YouTube URL Input */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700">
              Paste YouTube URL
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && youtubeUrl.trim() && !downloadingYoutube) {
                    downloadFromYoutube();
                  }
                }}
                placeholder="https://youtube.com/watch?v=..."
                disabled={downloadingYoutube || isUploading}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <button
                onClick={downloadFromYoutube}
                disabled={!youtubeUrl.trim() || downloadingYoutube || isUploading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {downloadingYoutube ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Downloading...
                  </span>
                ) : (
                  'Download'
                )}
              </button>
            </div>

            {/* Custom Timestamp Toggle */}
            <div className="mt-3">
              <button
                onClick={() => setShowTimestampInputs(!showTimestampInputs)}
                disabled={downloadingYoutube || isUploading}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
              >
                {showTimestampInputs ? '− Hide custom timestamps' : '+ Add custom timestamps'}
              </button>
            </div>

            {/* Timestamp Inputs */}
            {showTimestampInputs && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-600 mb-2">Trim video to specific segment (optional)</p>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Start (seconds)
                    </label>
                    <input
                      type="number"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      placeholder="0"
                      min="0"
                      step="0.1"
                      disabled={downloadingYoutube || isUploading}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      End (seconds)
                    </label>
                    <input
                      type="number"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      placeholder="auto"
                      min="0"
                      step="0.1"
                      disabled={downloadingYoutube || isUploading}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Example: Start at 10, End at 18 = 8 second clip
                </p>
              </div>
            )}

            <p className="mt-1.5 text-xs text-gray-400">
              Supports youtube.com and youtu.be links • Max 50MB
            </p>
          </div>
        </>
      )}
    </div>
  );
}
