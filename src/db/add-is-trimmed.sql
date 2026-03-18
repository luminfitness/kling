-- Add is_trimmed column to exercise_templates table
-- Run this in Supabase SQL Editor

ALTER TABLE exercise_templates
ADD COLUMN IF NOT EXISTS is_trimmed BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN exercise_templates.is_trimmed IS 'True if video was already trimmed during import';
