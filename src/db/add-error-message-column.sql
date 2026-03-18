-- Add error_message column to exercise_templates table
-- Run this in Supabase SQL Editor

ALTER TABLE exercise_templates
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add comment for documentation
COMMENT ON COLUMN exercise_templates.error_message IS 'Human-readable error message when had_issue is true';
