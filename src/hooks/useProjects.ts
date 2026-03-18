'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Project, ExerciseEntry } from '@/types';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    // Get projects with exercise counts
    const { data, error } = await supabase
      .from('projects')
      .select(`
        id,
        name,
        description,
        created_at,
        project_exercises (count)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load projects:', error);
      setLoading(false);
      return;
    }

    const mapped: Project[] = (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      createdAt: row.created_at,
      exerciseCount: row.project_exercises?.[0]?.count || 0,
    }));

    setProjects(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const createProject = useCallback(
    async (name: string, description?: string): Promise<Project> => {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      const { error } = await supabase.from('projects').insert({
        id,
        name,
        description: description || null,
        created_at: createdAt,
      });

      if (error) {
        console.error('Failed to create project:', error);
        throw error;
      }

      const project: Project = {
        id,
        name,
        description,
        createdAt,
        exerciseCount: 0,
      };

      await loadProjects();
      return project;
    },
    [loadProjects]
  );

  const updateProject = useCallback(
    async (id: string, updates: { name?: string; description?: string }) => {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.description !== undefined) dbUpdates.description = updates.description || null;

      const { error } = await supabase
        .from('projects')
        .update(dbUpdates)
        .eq('id', id);

      if (error) {
        console.error('Failed to update project:', error);
        throw error;
      }

      await loadProjects();
    },
    [loadProjects]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Failed to delete project:', error);
        throw error;
      }

      await loadProjects();
    },
    [loadProjects]
  );

  const addExercisesToProject = useCallback(
    async (projectId: string, exerciseIds: string[]) => {
      const rows = exerciseIds.map((exerciseId) => ({
        id: crypto.randomUUID(),
        project_id: projectId,
        exercise_id: exerciseId,
        added_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('project_exercises')
        .upsert(rows, { onConflict: 'project_id,exercise_id' });

      if (error) {
        console.error('Failed to add exercises to project:', error);
        throw error;
      }

      await loadProjects();
    },
    [loadProjects]
  );

  const removeExerciseFromProject = useCallback(
    async (projectId: string, exerciseId: string) => {
      const { error } = await supabase
        .from('project_exercises')
        .delete()
        .eq('project_id', projectId)
        .eq('exercise_id', exerciseId);

      if (error) {
        console.error('Failed to remove exercise from project:', error);
        throw error;
      }

      await loadProjects();
    },
    [loadProjects]
  );

  const getProjectExercises = useCallback(
    async (projectId: string): Promise<ExerciseEntry[]> => {
      const { data, error } = await supabase
        .from('project_exercises')
        .select(`
          exercise_id,
          added_at,
          exercise_entries (*)
        `)
        .eq('project_id', projectId)
        .order('added_at', { ascending: false });

      if (error) {
        console.error('Failed to load project exercises:', error);
        return [];
      }

      return (data || [])
        .filter((row: any) => row.exercise_entries)
        .map((row: any) => {
          const e = row.exercise_entries;
          return {
            id: e.id,
            exerciseName: e.exercise_name,
            equipmentType: e.equipment_type,
            outputVideoUrl: e.output_video_url,
            inputVideoUrl: e.input_video_url,
            positionId: e.position_id,
            positionName: e.position_name,
            mode: e.mode as 'std' | 'pro',
            costUsd: e.cost_usd,
            customPrompt: e.custom_prompt || undefined,
            force: e.force || undefined,
            mechanic: e.mechanic || undefined,
            limbs: e.limbs || undefined,
            body: e.body || undefined,
            difficulty: e.difficulty || undefined,
            musclesTargeted: e.muscles_targeted || undefined,
            processingDurationSec: e.processing_duration_sec || undefined,
            savedAt: e.saved_at,
            reviewed: e.reviewed || false,
            flagged: e.flagged || false,
          };
        });
    },
    []
  );

  return {
    projects,
    loading,
    createProject,
    updateProject,
    deleteProject,
    addExercisesToProject,
    removeExerciseFromProject,
    getProjectExercises,
    reloadProjects: loadProjects,
  };
}
