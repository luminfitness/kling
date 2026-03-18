'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { DropboxVideo } from '@/types';

interface DropboxVideoTableProps {
  videos: DropboxVideo[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onVideoClick: (video: DropboxVideo) => void;
  onBatchOutput: () => void;
  statusFilter: 'all' | DropboxVideo['status'];
  onStatusFilterChange: (status: 'all' | DropboxVideo['status']) => void;
}

const STATUS_LABELS: Record<DropboxVideo['status'], string> = {
  synced: 'Needs Position',
  position_ready: 'Ready',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

const STATUS_COLORS: Record<DropboxVideo['status'], string> = {
  synced: 'bg-gray-100 text-gray-700',
  position_ready: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function DropboxVideoTable({
  videos,
  selectedIds,
  onSelectionChange,
  onVideoClick,
  onBatchOutput,
  statusFilter,
  onStatusFilterChange,
}: DropboxVideoTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Filter videos by status
  const filteredVideos = useMemo(() => {
    if (statusFilter === 'all') return videos;
    return videos.filter((v) => v.status === statusFilter);
  }, [videos, statusFilter]);

  // Status counts for filter buttons
  const statusCounts = useMemo(() => {
    return {
      all: videos.length,
      synced: videos.filter((v) => v.status === 'synced').length,
      position_ready: videos.filter((v) => v.status === 'position_ready').length,
      processing: videos.filter((v) => v.status === 'processing').length,
      completed: videos.filter((v) => v.status === 'completed').length,
      failed: videos.filter((v) => v.status === 'failed').length,
    };
  }, [videos]);

  // Handle row click with shift-select
  const handleRowClick = (video: DropboxVideo, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const range = filteredVideos.slice(start, end + 1).map((v) => v.id);
      onSelectionChange(new Set([...Array.from(selectedIds), ...range]));
    } else if (e.metaKey || e.ctrlKey) {
      const newSet = new Set(selectedIds);
      if (newSet.has(video.id)) {
        newSet.delete(video.id);
      } else {
        newSet.add(video.id);
      }
      onSelectionChange(newSet);
      setLastSelectedIndex(index);
    } else {
      // Regular click - open position modal
      onVideoClick(video);
    }
  };

  // Handle checkbox click
  const handleCheckboxClick = (video: DropboxVideo, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(selectedIds);
    if (newSet.has(video.id)) {
      newSet.delete(video.id);
    } else {
      newSet.add(video.id);
    }
    onSelectionChange(newSet);
  };

  // Select all visible
  const handleSelectAll = () => {
    const visibleIds = filteredVideos.map((v) => v.id);
    onSelectionChange(new Set(visibleIds));
  };

  // Deselect all
  const handleDeselectAll = () => {
    onSelectionChange(new Set());
  };

  // Count selected that are ready for output
  const selectedReadyCount = useMemo(() => {
    return Array.from(selectedIds).filter((id) => {
      const video = videos.find((v) => v.id === id);
      return video?.status === 'position_ready';
    }).length;
  }, [selectedIds, videos]);

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header with filters */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-700">Status:</span>
          <button
            onClick={() => onStatusFilterChange('all')}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              statusFilter === 'all'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({statusCounts.all})
          </button>
          <button
            onClick={() => onStatusFilterChange('synced')}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              statusFilter === 'synced'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Needs Position ({statusCounts.synced})
          </button>
          <button
            onClick={() => onStatusFilterChange('position_ready')}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              statusFilter === 'position_ready'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            }`}
          >
            Ready ({statusCounts.position_ready})
          </button>
          <button
            onClick={() => onStatusFilterChange('completed')}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              statusFilter === 'completed'
                ? 'bg-green-600 text-white'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            Completed ({statusCounts.completed})
          </button>
          {statusCounts.processing > 0 && (
            <button
              onClick={() => onStatusFilterChange('processing')}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                statusFilter === 'processing'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              }`}
            >
              Processing ({statusCounts.processing})
            </button>
          )}
          {statusCounts.failed > 0 && (
            <button
              onClick={() => onStatusFilterChange('failed')}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                statusFilter === 'failed'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-100 text-red-700 hover:bg-red-200'
              }`}
            >
              Failed ({statusCounts.failed})
            </button>
          )}
        </div>
      </div>

      {/* Action bar when items selected */}
      {hasSelection && (
        <div className="px-4 py-2 border-b border-gray-200 bg-blue-50 flex items-center gap-3">
          <span className="text-sm text-blue-800">
            {selectedIds.size} selected
            {selectedReadyCount > 0 && selectedReadyCount < selectedIds.size && (
              <span className="text-blue-600"> ({selectedReadyCount} ready)</span>
            )}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleSelectAll}
            className="text-xs text-blue-600 hover:underline"
          >
            Select all visible
          </button>
          <button
            onClick={handleDeselectAll}
            className="text-xs text-blue-600 hover:underline"
          >
            Deselect all
          </button>
          {selectedReadyCount > 0 && (
            <button
              onClick={onBatchOutput}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Batch Output ({selectedReadyCount})
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div ref={tableRef} className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={filteredVideos.length > 0 && filteredVideos.every((v) => selectedIds.has(v.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleSelectAll();
                    } else {
                      handleDeselectAll();
                    }
                  }}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Exercise Name
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Status
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Position
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Review
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredVideos.map((video, index) => (
              <tr
                key={video.id}
                onClick={(e) => handleRowClick(video, index, e)}
                className={`cursor-pointer transition-colors ${
                  selectedIds.has(video.id)
                    ? 'bg-blue-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(video.id)}
                    onClick={(e) => handleCheckboxClick(video, e)}
                    onChange={() => {}}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {video.exerciseName}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                      STATUS_COLORS[video.status]
                    }`}
                  >
                    {STATUS_LABELS[video.status]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {video.positionImageUrl ? (
                    <img
                      src={video.positionImageUrl}
                      alt="Position"
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {video.status === 'completed' && (
                    <div className="flex items-center gap-2">
                      {video.reviewed ? (
                        <span className="text-green-600 text-xs">✓ Reviewed</span>
                      ) : video.flagged ? (
                        <span className="text-red-600 text-xs">⚠ Flagged</span>
                      ) : (
                        <span className="text-gray-400 text-xs">Pending</span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredVideos.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-400">
              {videos.length === 0
                ? 'No videos synced yet. Click "Sync from Dropbox" to get started.'
                : 'No videos match the selected filter.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
