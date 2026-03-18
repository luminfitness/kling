-- Add blend_type column to loop_ratings
ALTER TABLE loop_ratings ADD COLUMN blend_type text NOT NULL DEFAULT 'none';
