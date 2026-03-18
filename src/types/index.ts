// --- Position types ---

export interface Position {
  id: string;
  name: string;
  equipmentType: string; // Associated equipment (required)
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  createdAt: string;
}

// --- Equipment types ---

// Equipment type stored in database
export interface Equipment {
  id: string;
  name: string; // Display name (e.g., "Cable Machine")
  key: string;  // Storage key (e.g., "cable_machine")
  createdAt: string;
}

// Default equipment to seed database on first load
export const DEFAULT_EQUIPMENT: string[] = [
  'Barbell',
  'Dumbbell',
  'Dumbbells',
  'Kettlebell',
  'TRX',
];

// Helper to convert display name to storage key
export function equipmentNameToKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

// --- Exercise metadata types ---

export type ForceType = 'Compound' | 'Isolated';
export type MechanicType = 'Push' | 'Pull';
export type LimbType = 'Bilateral' | 'Alternating' | 'Unilateral';
export type BodyType = 'Full' | 'Upper' | 'Lower';
export type DifficultyType = 'Beginner' | 'Intermediate' | 'Advanced';

export const FORCE_OPTIONS: ForceType[] = ['Compound', 'Isolated'];
export const MECHANIC_OPTIONS: MechanicType[] = ['Push', 'Pull'];
export const LIMB_OPTIONS: LimbType[] = ['Bilateral', 'Alternating', 'Unilateral'];
export const BODY_OPTIONS: BodyType[] = ['Full', 'Upper', 'Lower'];
export const DIFFICULTY_OPTIONS: DifficultyType[] = ['Beginner', 'Intermediate', 'Advanced'];

export const MUSCLE_OPTIONS: string[] = [
  'Abdominals', 'All', 'Anterior Deltoid', 'Biceps', 'Brachioradialis',
  'Deltoid', 'Deltoids', 'Erector Spinae', 'Forearm Flexors', 'Forearm Extensors',
  'Forearms', 'Gastrocnemius', 'General Back', 'Gluteus Maximus', 'Gluteus Medius',
  'Gluteus Minimus', 'Hamstrings', 'Hip Abductors', 'Hip Adductors', 'Hip Flexors',
  'Infraspinatus', 'Latissimus Dorsi', 'Lateral Deltoid', 'Middle Trapezius',
  'Obliques', 'Pectoralis Major', 'Posterior Deltoid', 'Quadriceps',
  'Rectus Abdominis', 'Rhomboids', 'Teres Minor', 'Trapezius', 'Triceps',
  'Upper Trapezius',
];

export interface ExerciseMetadata {
  force?: ForceType;
  mechanic?: MechanicType[];
  limbs?: LimbType;
  body?: BodyType;
  difficulty?: DifficultyType;
  musclesTargeted?: string[];
}

// --- Kling API types ---

export interface KlingTaskResponse {
  taskId: string;
  status: 'submitted' | 'processing' | 'succeed' | 'failed';
  statusMessage: string;
  videos: Array<{
    id: string;
    url: string;
    duration: string;
  }>;
}

export interface ProcessRequest {
  imageUrl: string;
  videoUrl: string;
  characterOrientation: 'image' | 'video';
  mode: 'std' | 'pro';
  keepOriginalSound: 'yes' | 'no';
  prompt?: string;
}

export interface UploadResponse {
  url: string;
  filename: string;
}

// --- Task & exercise types ---

export interface PendingTaskMeta {
  taskId: string;
  videoUrl: string;
  positionId: string;
  positionName: string;
  mode: 'std' | 'pro';
  exerciseName: string;
  equipmentType: string;
  createdAt: string;
}

// Input template - Not yet processed
export interface ExerciseTemplate extends ExerciseMetadata {
  id: string;
  exerciseName: string;
  equipmentType: string;
  inputVideoUrl?: string; // MP4 upload
  youtubeUrl?: string; // YouTube URL
  startTime?: number; // Trim start in seconds
  endTime?: number; // Trim end in seconds
  positionId: string;
  positionName: string;
  customPositionUrl?: string; // Custom uploaded position image URL (overrides positionId)
  customPrompt: string;
  characterOrientation?: 'image' | 'video'; // API orientation mode (default: video)
  createdAt: string;
  isRerun?: boolean; // True if this template was created from a rerun
  sourceExerciseId?: string; // ID of the original exercise if this is a rerun
  hadIssue?: boolean; // True if this template was moved back from queue due to an issue
  errorMessage?: string; // Human-readable error message when hadIssue is true
  rerunNote?: string; // User note explaining why this rerun is needed
  isTrimmed?: boolean; // True if video was already trimmed during import
}

// Completed exercise - Has been processed
export interface ExerciseEntry extends ExerciseMetadata {
  id: string;
  exerciseName: string;
  equipmentType: string;
  outputVideoUrl: string;
  inputVideoUrl: string;
  positionId: string;
  positionName: string;
  mode: 'std' | 'pro';
  costUsd: number;
  customPrompt?: string;
  processingDurationSec?: number;
  videoDurationSec?: number; // Output video duration in seconds
  savedAt: string;
  reviewed?: boolean;
  flagged?: boolean;
  rerunning?: boolean; // True if this exercise is currently being rerun
}

export interface QueuedTask extends ExerciseMetadata {
  taskId: string; // Our internal ID (UUID) - always filled
  klingTaskId?: string; // Kling API task ID - filled after submission to Kling
  status: 'queued' | 'submitted' | 'processing' | 'succeed' | 'failed';
  videoUrl?: string; // Downloaded video URL - filled after download
  positionId: string;
  positionName: string;
  mode: 'std' | 'pro';
  exerciseName: string;
  equipmentType: string;
  customPrompt?: string;
  startedAt: string;
  outputVideoUrl?: string;
  videoDurationSec?: number;
  autoSaved?: boolean;
  templateId?: string; // Reference to ExerciseTemplate if from batch
  batchId?: string; // Group ID for batch processing
  batchPosition?: number; // Position in batch (1, 2, 3...)
  batchTotal?: number; // Total items in batch
  // Source info for resuming downloads after page refresh
  sourceYoutubeUrl?: string;
  sourceStartTime?: number;
  sourceEndTime?: number;
  sourceInputUrl?: string;
  // Error tracking
  errorMessage?: string; // Human-readable error message when status is 'failed'
  // Rerun tracking
  sourceExerciseId?: string; // ID of original exercise if this is a rerun
}

// --- Dropbox Video types ---

export interface DropboxVideo {
  id: string;
  filename: string;                // "Barbell Curl.mp4"
  exerciseName: string;            // "Barbell Curl" (parsed from filename)
  dropboxPath: string;             // Full Dropbox path
  tempLink?: string;               // 4hr temporary download link
  tempLinkExpiresAt?: string;      // When link expires

  // Position data (filled after position creation)
  positionImageUrl?: string;       // Generated position image URL
  poseFrameTime?: number;          // Which frame was selected for pose

  // Processing status
  status: 'synced' | 'position_ready' | 'processing' | 'completed' | 'failed';
  klingTaskId?: string;
  outputVideoUrl?: string;

  // Review status (same as exercise_entries)
  reviewed: boolean;
  flagged: boolean;

  // Metadata
  equipmentType: string;
  createdAt: string;
  updatedAt: string;
}

// --- Loop Result types ---

export interface LoopResultRow {
  id: string;
  exercise_name: string;
  method: string;
  rank: number;
  score: number;
  start_time: number;
  end_time: number;
  loop_duration: number;
  algorithm: string;
  fade_frames: number;
  video_url: string;
  rating: string | null;
  reviewed: boolean;
  flagged: boolean;
  keeper: boolean;
  downloaded: boolean;
  created_at: string;
}

export interface LoopExerciseSummary {
  exerciseName: string;
  variantCount: number;
  reviewed: boolean;
  hasKeeper: boolean;
  keeperLabel: string | null;
  flagged: boolean;
  downloaded: boolean;
  latestCreatedAt: string;
  rows: LoopResultRow[];
}

// --- Project types ---

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  exerciseCount?: number; // Computed field for display
}

export interface ProjectExercise {
  id: string;
  projectId: string;
  exerciseId: string;
  addedAt: string;
}
