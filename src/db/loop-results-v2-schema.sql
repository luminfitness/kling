-- Loop Results V2: stores morph cut comparison results from Python processor
CREATE TABLE IF NOT EXISTS loop_results_v2 (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    exercise_name TEXT NOT NULL,
    method TEXT NOT NULL,          -- 'MAD' or 'SSIM'
    rank INT NOT NULL,             -- candidate rank (1, 2, 3)
    score NUMERIC NOT NULL,        -- similarity score 0-1
    start_time NUMERIC NOT NULL,   -- loop start (seconds)
    end_time NUMERIC NOT NULL,     -- loop end (seconds)
    loop_duration NUMERIC NOT NULL,
    algorithm TEXT NOT NULL,        -- 'crossfade', 'farneback', 'dis', 'delaunay'
    fade_frames INT NOT NULL,      -- 1, 2, or 3
    video_url TEXT NOT NULL,       -- Supabase Storage public URL
    rating TEXT,                   -- 'good' | 'bad' (set from web UI)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups by exercise
CREATE INDEX IF NOT EXISTS idx_loop_results_v2_exercise ON loop_results_v2(exercise_name);

-- RLS: allow all access with anon key (same pattern as other tables)
ALTER TABLE loop_results_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON loop_results_v2 FOR ALL USING (true) WITH CHECK (true);
