'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { LoopResultRow, LoopExerciseSummary } from '@/types';

export function useLoopResults() {
  const [exercises, setExercises] = useState<LoopExerciseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadResults = useCallback(async () => {
    const { data, error } = await supabase
      .from('loop_results_v2')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load loop results:', error);
      setLoading(false);
      return;
    }

    const rows: LoopResultRow[] = (data || []).map((r) => ({
      id: r.id,
      exercise_name: r.exercise_name,
      method: r.method,
      rank: r.rank,
      score: r.score,
      start_time: r.start_time,
      end_time: r.end_time,
      loop_duration: r.loop_duration,
      algorithm: r.algorithm,
      fade_frames: r.fade_frames,
      video_url: r.video_url,
      rating: r.rating || null,
      reviewed: r.reviewed || false,
      flagged: r.flagged || false,
      keeper: r.keeper || false,
      downloaded: r.downloaded || false,
      created_at: r.created_at,
    }));

    // Group by exercise_name, keep only latest batch per exercise
    const grouped = new Map<string, LoopResultRow[]>();
    for (const row of rows) {
      const existing = grouped.get(row.exercise_name);
      if (existing) {
        existing.push(row);
      } else {
        grouped.set(row.exercise_name, [row]);
      }
    }

    // For each exercise, only keep rows from the latest batch (same created_at prefix within ~1 hour)
    const summaries: LoopExerciseSummary[] = [];
    for (const [exerciseName, exerciseRows] of Array.from(grouped)) {
      // Sort by created_at desc
      exerciseRows.sort((a, b) => b.created_at.localeCompare(a.created_at));

      // Keep all rows (they're already from the latest runs)
      const latestCreatedAt = exerciseRows[0]?.created_at || '';
      const keeperRow = exerciseRows.find((r) => r.keeper);

      summaries.push({
        exerciseName,
        variantCount: exerciseRows.length,
        reviewed: exerciseRows.every((r) => r.reviewed),
        hasKeeper: !!keeperRow,
        keeperLabel: keeperRow ? `#${keeperRow.rank} ${keeperRow.fade_frames}f` : null,
        flagged: exerciseRows.some((r) => r.flagged),
        downloaded: exerciseRows.some((r) => r.downloaded),
        latestCreatedAt,
        rows: exerciseRows,
      });
    }

    // Sort by latest created_at desc
    summaries.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));

    setExercises(summaries);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const setKeeper = useCallback(async (rowId: string) => {
    // Find which exercise this row belongs to
    const exercise = exercises.find((e) => e.rows.some((r) => r.id === rowId));
    if (!exercise) return;

    // Clear keeper on all rows for this exercise
    const allIds = exercise.rows.map((r) => r.id);
    await supabase
      .from('loop_results_v2')
      .update({ keeper: false })
      .in('id', allIds);

    // Set keeper on the selected row
    await supabase
      .from('loop_results_v2')
      .update({ keeper: true })
      .eq('id', rowId);

    await loadResults();
  }, [exercises, loadResults]);

  const clearKeeper = useCallback(async (exerciseName: string) => {
    const exercise = exercises.find((e) => e.exerciseName === exerciseName);
    if (!exercise) return;

    const allIds = exercise.rows.map((r) => r.id);
    await supabase
      .from('loop_results_v2')
      .update({ keeper: false })
      .in('id', allIds);

    await loadResults();
  }, [exercises, loadResults]);

  const toggleFlag = useCallback(async (exerciseName: string) => {
    const exercise = exercises.find((e) => e.exerciseName === exerciseName);
    if (!exercise) return;

    const newFlagged = !exercise.flagged;
    const allIds = exercise.rows.map((r) => r.id);
    await supabase
      .from('loop_results_v2')
      .update({ flagged: newFlagged })
      .in('id', allIds);

    await loadResults();
  }, [exercises, loadResults]);

  const markReviewed = useCallback(async (exerciseName: string) => {
    const exercise = exercises.find((e) => e.exerciseName === exerciseName);
    if (!exercise) return;

    const allIds = exercise.rows.map((r) => r.id);
    await supabase
      .from('loop_results_v2')
      .update({ reviewed: true })
      .in('id', allIds);

    await loadResults();
  }, [exercises, loadResults]);

  const markDownloaded = useCallback(async (rowId: string) => {
    await supabase
      .from('loop_results_v2')
      .update({ downloaded: true })
      .eq('id', rowId);

    await loadResults();
  }, [loadResults]);

  const updateRating = useCallback(async (rowId: string, rating: string | null) => {
    await supabase
      .from('loop_results_v2')
      .update({ rating })
      .eq('id', rowId);

    await loadResults();
  }, [loadResults]);

  return {
    exercises,
    loading,
    setKeeper,
    clearKeeper,
    toggleFlag,
    markReviewed,
    markDownloaded,
    updateRating,
    refresh: loadResults,
  };
}
