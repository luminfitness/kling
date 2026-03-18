'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { DropboxVideo } from '@/types';

// Map database row to DropboxVideo interface
function mapRowToVideo(row: Record<string, unknown>): DropboxVideo {
  return {
    id: row.id as string,
    filename: row.filename as string,
    exerciseName: row.exercise_name as string,
    dropboxPath: row.dropbox_path as string,
    tempLink: row.temp_link as string | undefined,
    tempLinkExpiresAt: row.temp_link_expires_at as string | undefined,
    positionImageUrl: row.position_image_url as string | undefined,
    poseFrameTime: row.pose_frame_time as number | undefined,
    status: row.status as DropboxVideo['status'],
    klingTaskId: row.kling_task_id as string | undefined,
    outputVideoUrl: row.output_video_url as string | undefined,
    reviewed: row.reviewed as boolean,
    flagged: row.flagged as boolean,
    equipmentType: row.equipment_type as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function useDropboxVideos() {
  const [videos, setVideos] = useState<DropboxVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Load videos from Supabase
  const loadVideos = useCallback(async () => {
    const { data, error } = await supabase
      .from('dropbox_videos')
      .select('*')
      .order('exercise_name', { ascending: true });

    if (error) {
      console.error('[useDropboxVideos] Failed to load videos:', error);
      setLoading(false);
      return;
    }

    const mapped = (data || []).map(mapRowToVideo);
    setVideos(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // Sync videos from Dropbox
  const syncFromDropbox = useCallback(async (): Promise<{
    synced: number;
    total: number;
  }> => {
    setSyncing(true);
    try {
      const res = await fetch('/api/dropbox/sync');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      // Update local state with synced videos
      if (data.videos) {
        const mapped = data.videos.map(mapRowToVideo);
        setVideos(mapped);
      }

      return {
        synced: data.synced || 0,
        total: data.total || 0,
      };
    } finally {
      setSyncing(false);
    }
  }, []);

  // Get temporary download link for a video
  const getVideoLink = useCallback(async (video: DropboxVideo): Promise<string> => {
    // Check if existing link is still valid (with 5 minute buffer)
    if (video.tempLink && video.tempLinkExpiresAt) {
      const expiresAt = new Date(video.tempLinkExpiresAt).getTime();
      const now = Date.now();
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (expiresAt - now > bufferMs) {
        return video.tempLink;
      }
    }

    // Get new link from API
    const res = await fetch('/api/dropbox/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dropboxPath: video.dropboxPath,
        videoId: video.id,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to get video link');
    }

    // Update local state
    setVideos((prev) =>
      prev.map((v) =>
        v.id === video.id
          ? { ...v, tempLink: data.url, tempLinkExpiresAt: data.expiresAt }
          : v
      )
    );

    return data.url;
  }, []);

  // Update video in database
  const updateVideo = useCallback(
    async (id: string, updates: Partial<DropboxVideo>): Promise<void> => {
      // Map DropboxVideo fields to database column names
      const dbUpdates: Record<string, unknown> = {};
      if (updates.positionImageUrl !== undefined) dbUpdates.position_image_url = updates.positionImageUrl;
      if (updates.poseFrameTime !== undefined) dbUpdates.pose_frame_time = updates.poseFrameTime;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.klingTaskId !== undefined) dbUpdates.kling_task_id = updates.klingTaskId;
      if (updates.outputVideoUrl !== undefined) dbUpdates.output_video_url = updates.outputVideoUrl;
      if (updates.reviewed !== undefined) dbUpdates.reviewed = updates.reviewed;
      if (updates.flagged !== undefined) dbUpdates.flagged = updates.flagged;
      if (updates.equipmentType !== undefined) dbUpdates.equipment_type = updates.equipmentType;
      if (updates.tempLink !== undefined) dbUpdates.temp_link = updates.tempLink;
      if (updates.tempLinkExpiresAt !== undefined) dbUpdates.temp_link_expires_at = updates.tempLinkExpiresAt;

      const { error } = await supabase
        .from('dropbox_videos')
        .update(dbUpdates)
        .eq('id', id);

      if (error) {
        throw new Error(`Failed to update video: ${error.message}`);
      }

      // Update local state
      setVideos((prev) =>
        prev.map((v) => (v.id === id ? { ...v, ...updates } : v))
      );
    },
    []
  );

  // Delete video from database
  const deleteVideo = useCallback(
    async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('dropbox_videos')
        .delete()
        .eq('id', id);

      if (error) {
        throw new Error(`Failed to delete video: ${error.message}`);
      }

      setVideos((prev) => prev.filter((v) => v.id !== id));
    },
    []
  );

  // Get videos by status
  const getByStatus = useCallback(
    (status: DropboxVideo['status']): DropboxVideo[] => {
      return videos.filter((v) => v.status === status);
    },
    [videos]
  );

  // Counts
  const counts = {
    total: videos.length,
    synced: videos.filter((v) => v.status === 'synced').length,
    positionReady: videos.filter((v) => v.status === 'position_ready').length,
    processing: videos.filter((v) => v.status === 'processing').length,
    completed: videos.filter((v) => v.status === 'completed').length,
    failed: videos.filter((v) => v.status === 'failed').length,
    reviewed: videos.filter((v) => v.reviewed).length,
    flagged: videos.filter((v) => v.flagged).length,
  };

  return {
    videos,
    loading,
    syncing,
    counts,
    loadVideos,
    syncFromDropbox,
    getVideoLink,
    updateVideo,
    deleteVideo,
    getByStatus,
  };
}
