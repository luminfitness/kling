'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ExerciseEntry, ExerciseMetadata } from '@/types';

export function useExerciseLibrary() {
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadExercises = useCallback(async () => {
    const { data, error } = await supabase
      .from('exercise_entries')
      .select('*')
      .order('saved_at', { ascending: false });

    if (error) {
      console.error('Failed to load exercises:', error);
      setLoading(false);
      return;
    }

    const mapped: ExerciseEntry[] = (data || []).map((row) => ({
      id: row.id,
      exerciseName: row.exercise_name,
      equipmentType: row.equipment_type,
      outputVideoUrl: row.output_video_url,
      inputVideoUrl: row.input_video_url,
      positionId: row.position_id,
      positionName: row.position_name,
      mode: row.mode as 'std' | 'pro',
      costUsd: row.cost_usd,
      customPrompt: row.custom_prompt || undefined,
      force: row.force || undefined,
      mechanic: row.mechanic || undefined,
      limbs: row.limbs || undefined,
      body: row.body || undefined,
      difficulty: row.difficulty || undefined,
      musclesTargeted: row.muscles_targeted || undefined,
      processingDurationSec: row.processing_duration_sec || undefined,
      videoDurationSec: row.video_duration_sec || undefined,
      savedAt: row.saved_at,
      reviewed: row.reviewed || false,
      flagged: row.flagged || false,
      rerunning: row.rerunning || false,
    }));

    setExercises(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadExercises();
  }, [loadExercises]);

  const saveExercise = useCallback(
    async (params: {
      exerciseName: string;
      equipmentType: string;
      outputVideoUrl: string;
      inputVideoUrl: string;
      positionId: string;
      positionName: string;
      mode: 'std' | 'pro';
      costUsd: number;
      customPrompt?: string;
    } & ExerciseMetadata): Promise<ExerciseEntry> => {
      const id = crypto.randomUUID();
      const savedAt = new Date().toISOString();

      // Check if positionId is a valid UUID (not 'custom' or empty)
      const isValidUuid = params.positionId && params.positionId !== 'custom' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.positionId);
      const positionUuid = isValidUuid ? params.positionId : null;

      const { error } = await supabase.from('exercise_entries').insert({
        id,
        exercise_name: params.exerciseName,
        equipment_type: params.equipmentType,
        output_video_url: params.outputVideoUrl,
        input_video_url: params.inputVideoUrl,
        // Legacy columns (nullable in DB)
        avatar_id: positionUuid,
        avatar_name: params.positionName,
        avatar_angle: 'front',
        // Current columns
        position_id: positionUuid,
        position_name: params.positionName,
        mode: params.mode,
        cost_usd: params.costUsd,
        custom_prompt: params.customPrompt || null,
        force: params.force || null,
        mechanic: params.mechanic || null,
        limbs: params.limbs || null,
        body: params.body || null,
        difficulty: params.difficulty || null,
        muscles_targeted: params.musclesTargeted || null,
        saved_at: savedAt,
      });

      if (error) {
        console.error('Failed to save exercise:', error);
        throw new Error(`Failed to save exercise: ${error.message}`);
      }

      const entry: ExerciseEntry = {
        id,
        ...params,
        savedAt,
      };

      await loadExercises();
      return entry;
    },
    [loadExercises]
  );

  const updateExercise = useCallback(
    async (
      id: string,
      updates: Partial<Pick<ExerciseEntry, 'exerciseName' | 'equipmentType' | 'reviewed' | 'flagged' | 'rerunning'> & ExerciseMetadata>
    ) => {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.exerciseName !== undefined) dbUpdates.exercise_name = updates.exerciseName;
      if (updates.equipmentType !== undefined) dbUpdates.equipment_type = updates.equipmentType;
      if (updates.reviewed !== undefined) dbUpdates.reviewed = updates.reviewed;
      if (updates.flagged !== undefined) dbUpdates.flagged = updates.flagged;
      if (updates.rerunning !== undefined) dbUpdates.rerunning = updates.rerunning;
      if (updates.force !== undefined) dbUpdates.force = updates.force || null;
      if (updates.mechanic !== undefined) dbUpdates.mechanic = updates.mechanic || null;
      if (updates.limbs !== undefined) dbUpdates.limbs = updates.limbs || null;
      if (updates.body !== undefined) dbUpdates.body = updates.body || null;
      if (updates.difficulty !== undefined) dbUpdates.difficulty = updates.difficulty || null;
      if (updates.musclesTargeted !== undefined) dbUpdates.muscles_targeted = updates.musclesTargeted || null;

      const { error } = await supabase
        .from('exercise_entries')
        .update(dbUpdates)
        .eq('id', id);

      if (error) {
        console.error('Failed to update exercise:', error);
      }

      await loadExercises();
    },
    [loadExercises]
  );

  const deleteExercise = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('exercise_entries')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Failed to delete exercise:', error);
      }

      await loadExercises();
    },
    [loadExercises]
  );

  return { exercises, loading, saveExercise, updateExercise, deleteExercise, reloadExercises: loadExercises };
}
