-- Projects Schema Migration
-- Run this in Supabase SQL Editor

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table for project <-> exercise relationship
CREATE TABLE IF NOT EXISTS project_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercise_entries(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure each exercise can only be in a project once
  UNIQUE(project_id, exercise_id)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_project_exercises_project_id ON project_exercises(project_id);
CREATE INDEX IF NOT EXISTS idx_project_exercises_exercise_id ON project_exercises(exercise_id);

-- Enable RLS (Row Level Security) - open for now (no auth)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_exercises ENABLE ROW LEVEL SECURITY;

-- Policies (allow all operations for now)
CREATE POLICY "Allow all on projects" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on project_exercises" ON project_exercises FOR ALL USING (true) WITH CHECK (true);
