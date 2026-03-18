'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { usePolling } from '@/hooks/usePolling';
import { getPendingTask } from '@/lib/pendingTask';
import { updateTask } from '@/lib/taskQueue';
import ProcessingStatus from '@/components/ProcessingStatus';
import ResultDisplay from '@/components/ResultDisplay';
import type { PendingTaskMeta } from '@/types';

export default function ResultPage() {
  const params = useParams();
  const taskId = params.taskId as string;
  const { data, error, isPolling, elapsedSeconds } = usePolling(taskId);
  const [taskMeta, setTaskMeta] = useState<PendingTaskMeta | null>(null);
  const queueUpdated = useRef(false);

  useEffect(() => {
    const meta = getPendingTask(taskId);
    if (meta) setTaskMeta(meta);
  }, [taskId]);

  // Update task queue when status changes
  useEffect(() => {
    if (!data) return;
    const sync = async () => {
      if (data.status === 'succeed' && !queueUpdated.current) {
        queueUpdated.current = true;
        const dur = data.videos?.[0]?.duration
          ? parseFloat(data.videos[0].duration)
          : undefined;
        await updateTask(taskId, {
          status: 'succeed',
          outputVideoUrl: data.videos?.[0]?.url,
          videoDurationSec: isNaN(dur as number) ? undefined : dur,
        });
      } else if (data.status === 'failed' && !queueUpdated.current) {
        queueUpdated.current = true;
        await updateTask(taskId, { status: 'failed' });
      } else if (
        data.status === 'processing' &&
        !queueUpdated.current
      ) {
        await updateTask(taskId, { status: 'processing' });
      }
    };
    sync();
  }, [data, taskId]);

  // Calculate video duration for cost
  const videoDurationSec = data?.videos?.[0]?.duration
    ? parseFloat(data.videos[0].duration)
    : undefined;

  if (error) {
    return (
      <div className="flex flex-col items-center py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <span className="text-2xl text-red-600">!</span>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-gray-900">
          Something went wrong
        </h2>
        <p className="mb-6 text-sm text-gray-500">{error}</p>
        <a
          href="/"
          className="rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Try Again
        </a>
      </div>
    );
  }

  if (data?.status === 'failed') {
    return (
      <div className="flex flex-col items-center py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <span className="text-2xl text-red-600">!</span>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-gray-900">
          Processing Failed
        </h2>
        <p className="mb-6 text-sm text-gray-500">
          {data.statusMessage || 'The video transformation could not be completed.'}
        </p>
        <a
          href="/"
          className="rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Try Again
        </a>
      </div>
    );
  }

  if (data?.status === 'succeed' && data.videos.length > 0) {
    return (
      <div>
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-900">
          Your Transformed Video
        </h1>
        <ResultDisplay
          videoUrl={data.videos[0].url}
          taskMeta={taskMeta}
          videoDurationSec={videoDurationSec}
        />
      </div>
    );
  }

  return (
    <ProcessingStatus
      status={data?.status || 'submitted'}
      elapsedSeconds={elapsedSeconds}
    />
  );
}
