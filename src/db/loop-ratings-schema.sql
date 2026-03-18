-- Loop finder feedback ratings
-- Stores user ratings on loop candidates to tune algorithm parameters over time

create table if not exists loop_ratings (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),

  -- Video context
  file_name text not null,
  video_duration_sec numeric,

  -- Algorithm info
  method text not null,          -- 'MAD' or 'SSIM+Histogram'
  rank int not null,             -- 1-3
  score numeric not null,        -- algorithm score 0-1

  -- Loop points
  start_time numeric not null,
  end_time numeric not null,
  loop_duration numeric not null,

  -- User verdict
  rating text not null           -- 'good' or 'bad'
);

-- Index for analysis queries
create index idx_loop_ratings_method on loop_ratings(method);
create index idx_loop_ratings_rating on loop_ratings(rating);
