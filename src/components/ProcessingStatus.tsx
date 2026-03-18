'use client';

interface ProcessingStatusProps {
  status: string;
  elapsedSeconds: number;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function ProcessingStatus({
  status,
  elapsedSeconds,
}: ProcessingStatusProps) {
  const statusText =
    status === 'submitted'
      ? 'Queued - waiting to start...'
      : 'Processing your video...';

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative mb-6">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-gray-900">
        Transforming Video
      </h2>
      <p className="mb-4 text-sm text-gray-500">{statusText}</p>
      <div className="rounded-full bg-gray-100 px-4 py-1.5">
        <span className="text-sm font-mono text-gray-600">
          {formatTime(elapsedSeconds)}
        </span>
      </div>
      <p className="mt-4 text-xs text-gray-400">
        This typically takes a few minutes. You can leave this page open.
      </p>
    </div>
  );
}
