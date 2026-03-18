-- Dropbox Videos Table
-- Run this in Supabase SQL Editor to create the table

CREATE TABLE IF NOT EXISTS dropbox_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,              -- "Barbell Curl.mp4"
  exercise_name TEXT NOT NULL,         -- "Barbell Curl" (parsed from filename)
  dropbox_path TEXT NOT NULL UNIQUE,   -- Full Dropbox path (unique to prevent duplicates)
  temp_link TEXT,                      -- 4hr temporary download link
  temp_link_expires_at TIMESTAMPTZ,    -- When link expires

  -- Position data (filled after position creation)
  position_image_url TEXT,             -- Generated position image URL
  pose_frame_time FLOAT,               -- Which frame was selected for pose

  -- Processing status
  status TEXT DEFAULT 'synced' CHECK (status IN ('synced', 'position_ready', 'processing', 'completed', 'failed')),
  kling_task_id TEXT,
  output_video_url TEXT,

  -- Review status (same as exercise_entries)
  reviewed BOOLEAN DEFAULT FALSE,
  flagged BOOLEAN DEFAULT FALSE,

  -- Metadata
  equipment_type TEXT DEFAULT 'Bodyweight',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster status filtering
CREATE INDEX IF NOT EXISTS idx_dropbox_videos_status ON dropbox_videos(status);

-- Enable RLS (Row Level Security) - allow all for now (single-user app)
ALTER TABLE dropbox_videos ENABLE ROW LEVEL SECURITY;

-- Policy to allow all operations (adjust if multi-user needed)
CREATE POLICY "Allow all operations on dropbox_videos" ON dropbox_videos
  FOR ALL USING (true) WITH CHECK (true);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_dropbox_videos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function on update
DROP TRIGGER IF EXISTS trigger_dropbox_videos_updated_at ON dropbox_videos;
CREATE TRIGGER trigger_dropbox_videos_updated_at
  BEFORE UPDATE ON dropbox_videos
  FOR EACH ROW
  EXECUTE FUNCTION update_dropbox_videos_updated_at();
