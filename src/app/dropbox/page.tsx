'use client';

import { useState, useCallback } from 'react';
import { useDropboxVideos } from '@/hooks/useDropboxVideos';
import { usePositions } from '@/hooks/usePositions';
import DropboxVideoTable from '@/components/DropboxVideoTable';
import DropboxPositionModal from '@/components/DropboxPositionModal';
import type { DropboxVideo } from '@/types';

export default function DropboxPage() {
  const {
    videos,
    loading,
    syncing,
    counts,
    syncFromDropbox,
    updateVideo,
    getVideoLink,
  } = useDropboxVideos();

  const { positions } = usePositions();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | DropboxVideo['status']>('all');
  const [syncResult, setSyncResult] = useState<{ synced: number; total: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Position modal state
  const [selectedVideo, setSelectedVideo] = useState<DropboxVideo | null>(null);

  const handleSync = async () => {
    setSyncError(null);
    setSyncResult(null);
    try {
      const result = await syncFromDropbox();
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const handleVideoClick = (video: DropboxVideo) => {
    setSelectedVideo(video);
  };

  // Handle saving position from modal
  const handleSavePosition = async (positionImageUrl: string, poseFrameTime: number) => {
    if (!selectedVideo) return;

    try {
      // Upload the generated position image to storage
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'image',
          dataUrl: positionImageUrl,
        }),
      });

      let finalImageUrl = positionImageUrl;

      // If upload worked, use the storage URL
      if (response.ok) {
        const data = await response.json();
        finalImageUrl = data.url;
      }

      // Update the video with position data
      await updateVideo(selectedVideo.id, {
        positionImageUrl: finalImageUrl,
        poseFrameTime,
        status: 'position_ready',
      });

      setSelectedVideo(null);
    } catch (err) {
      console.error('Failed to save position:', err);
      throw err;
    }
  };

  const handleBatchOutput = useCallback(async () => {
    // Get selected videos that are ready
    const readyVideos = videos.filter(
      (v) => selectedIds.has(v.id) && v.status === 'position_ready'
    );

    if (readyVideos.length === 0) {
      alert('No videos ready for output. Create positions first.');
      return;
    }

    // TODO: Implement batch output using BatchSubmissionContext pattern
    console.log('Batch output:', readyVideos.length, 'videos');
    alert(`Batch output for ${readyVideos.length} videos - implementation pending`);
  }, [selectedIds, videos]);

  const handleSelectionChange = (ids: Set<string>) => {
    setSelectedIds(ids);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Loading Dropbox videos...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dropbox Import</h1>
            <p className="mt-1 text-sm text-gray-500">
              Import exercise videos from Dropbox, create positions, and batch process
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              syncing
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {syncing ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Syncing...
              </span>
            ) : (
              'Sync from Dropbox'
            )}
          </button>
        </div>

        {/* Stats */}
        <div className="mt-4 flex items-center gap-4 flex-wrap">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
            {counts.total} Total
          </span>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {counts.synced} Need Position
          </span>
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {counts.positionReady} Ready
          </span>
          {counts.processing > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {counts.processing} Processing
            </span>
          )}
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
            {counts.completed} Completed
          </span>
          {counts.failed > 0 && (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
              {counts.failed} Failed
            </span>
          )}
        </div>
      </div>

      {/* Sync result/error messages */}
      {syncResult && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-green-800">
              Synced {syncResult.synced} video{syncResult.synced !== 1 ? 's' : ''} from Dropbox.
              Total: {syncResult.total}
            </p>
            <button
              onClick={() => setSyncResult(null)}
              className="text-green-600 hover:text-green-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {syncError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-800">{syncError}</p>
            <button
              onClick={() => setSyncError(null)}
              className="text-red-600 hover:text-red-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {videos.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-12 w-12 text-gray-300 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
          </svg>
          <p className="text-sm text-gray-500 mb-2">No videos synced yet</p>
          <p className="text-xs text-gray-400 mb-4">
            Click "Sync from Dropbox" to import videos from your folder
          </p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {syncing ? 'Syncing...' : 'Sync from Dropbox'}
          </button>
        </div>
      ) : (
        <DropboxVideoTable
          videos={videos}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          onVideoClick={handleVideoClick}
          onBatchOutput={handleBatchOutput}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      )}

      {/* Position Modal */}
      {selectedVideo && (
        <DropboxPositionModal
          isOpen={true}
          onClose={() => setSelectedVideo(null)}
          video={selectedVideo}
          onSave={handleSavePosition}
          positions={positions}
          getVideoLink={getVideoLink}
        />
      )}
    </div>
  );
}
