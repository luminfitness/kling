'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ExerciseTemplate } from '@/types';

export function useExerciseTemplates() {
  const [templates, setTemplates] = useState<ExerciseTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from('exercise_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load templates:', error);
      setLoading(false);
      return;
    }

    const mapped: ExerciseTemplate[] = (data || []).map((row) => ({
      id: row.id,
      exerciseName: row.exercise_name,
      equipmentType: row.equipment_type,
      inputVideoUrl: row.input_video_url || undefined,
      youtubeUrl: row.youtube_url || undefined,
      startTime: row.start_time ?? undefined,
      endTime: row.end_time ?? undefined,
      positionId: row.position_id,
      positionName: row.position_name,
      customPrompt: row.custom_prompt,
      force: row.force || undefined,
      mechanic: row.mechanic || undefined,
      limbs: row.limbs || undefined,
      body: row.body || undefined,
      difficulty: row.difficulty || undefined,
      musclesTargeted: row.muscles_targeted || undefined,
      createdAt: row.created_at,
      hadIssue: row.had_issue || false,
      isRerun: row.is_rerun || false,
      sourceExerciseId: row.source_exercise_id || undefined,
      errorMessage: row.error_message || undefined,
      rerunNote: row.rerun_note || undefined,
      isTrimmed: row.is_trimmed || false,
    }));

    setTemplates(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const addTemplate = useCallback(
    async (template: Omit<ExerciseTemplate, 'id' | 'createdAt'>): Promise<ExerciseTemplate> => {
      const id = `template-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const createdAt = new Date().toISOString();

      const { error } = await supabase.from('exercise_templates').insert({
        id,
        exercise_name: template.exerciseName,
        equipment_type: template.equipmentType || null,
        input_video_url: template.inputVideoUrl || null,
        youtube_url: template.youtubeUrl || null,
        start_time: template.startTime ?? null,
        end_time: template.endTime ?? null,
        position_id: template.positionId || null,
        position_name: template.positionName || null,
        custom_prompt: template.customPrompt || null,
        force: template.force || null,
        mechanic: template.mechanic || null,
        limbs: template.limbs || null,
        body: template.body || null,
        difficulty: template.difficulty || null,
        muscles_targeted: template.musclesTargeted || null,
        created_at: createdAt,
        had_issue: template.hadIssue || false,
        is_rerun: template.isRerun || false,
        source_exercise_id: template.sourceExerciseId || null,
        error_message: template.errorMessage || null,
        rerun_note: template.rerunNote || null,
        is_trimmed: template.isTrimmed || false,
      });

      if (error) {
        console.error('Failed to add template:', error);
        throw new Error(`Failed to save template: ${error.message}`);
      }

      const newTemplate: ExerciseTemplate = { ...template, id, createdAt };
      await loadTemplates();
      return newTemplate;
    },
    [loadTemplates]
  );

  const updateTemplate = useCallback(
    async (id: string, updates: Partial<ExerciseTemplate>) => {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.exerciseName !== undefined) dbUpdates.exercise_name = updates.exerciseName;
      if (updates.equipmentType !== undefined) dbUpdates.equipment_type = updates.equipmentType;
      if ('inputVideoUrl' in updates) dbUpdates.input_video_url = updates.inputVideoUrl || null;
      if ('youtubeUrl' in updates) dbUpdates.youtube_url = updates.youtubeUrl || null;
      if (updates.startTime !== undefined) dbUpdates.start_time = updates.startTime ?? null;
      if (updates.endTime !== undefined) dbUpdates.end_time = updates.endTime ?? null;
      if ('positionId' in updates) dbUpdates.position_id = updates.positionId || null;
      if ('positionName' in updates) dbUpdates.position_name = updates.positionName || null;
      if (updates.customPrompt !== undefined) dbUpdates.custom_prompt = updates.customPrompt;
      if (updates.force !== undefined) dbUpdates.force = updates.force || null;
      if (updates.mechanic !== undefined) dbUpdates.mechanic = updates.mechanic || null;
      if (updates.limbs !== undefined) dbUpdates.limbs = updates.limbs || null;
      if (updates.body !== undefined) dbUpdates.body = updates.body || null;
      if (updates.difficulty !== undefined) dbUpdates.difficulty = updates.difficulty || null;
      if (updates.musclesTargeted !== undefined) dbUpdates.muscles_targeted = updates.musclesTargeted || null;
      if (updates.hadIssue !== undefined) dbUpdates.had_issue = updates.hadIssue;
      if (updates.isRerun !== undefined) dbUpdates.is_rerun = updates.isRerun;
      if (updates.sourceExerciseId !== undefined) dbUpdates.source_exercise_id = updates.sourceExerciseId || null;
      if (updates.errorMessage !== undefined) dbUpdates.error_message = updates.errorMessage || null;
      if (updates.rerunNote !== undefined) dbUpdates.rerun_note = updates.rerunNote || null;
      if (updates.isTrimmed !== undefined) dbUpdates.is_trimmed = updates.isTrimmed;

      if (Object.keys(dbUpdates).length > 0) {
        console.log('[updateTemplate] Saving to DB:', { id, keys: Object.keys(dbUpdates), input_video_url: dbUpdates.input_video_url ? 'set' : 'not set' });
        const { error } = await supabase
          .from('exercise_templates')
          .update(dbUpdates)
          .eq('id', id);

        if (error) {
          console.error('[updateTemplate] DB error:', error);
          throw new Error(`Failed to update template: ${error.message}`);
        }
        console.log('[updateTemplate] DB update succeeded');
      } else {
        console.log('[updateTemplate] No fields to update');
      }

      await loadTemplates();
      console.log('[updateTemplate] Templates reloaded');
    },
    [loadTemplates]
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('exercise_templates')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Failed to delete template:', error);
      }

      await loadTemplates();
    },
    [loadTemplates]
  );

  const getTemplate = useCallback(
    (id: string): ExerciseTemplate | undefined => {
      return templates.find((t) => t.id === id);
    },
    [templates]
  );

  return {
    templates,
    loading,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    getTemplate,
    reloadTemplates: loadTemplates,
  };
}
