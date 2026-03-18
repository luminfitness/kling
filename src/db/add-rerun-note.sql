-- Add rerun_note column to exercise_templates table
-- Run this in Supabase SQL Editor

ALTER TABLE exercise_templates
ADD COLUMN IF NOT EXISTS rerun_note TEXT;

-- Add a comment to describe the column
COMMENT ON COLUMN exercise_templates.rerun_note IS 'User note explaining why this rerun is needed';
