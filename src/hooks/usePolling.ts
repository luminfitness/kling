'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { KlingTaskResponse } from '@/types';

export function usePolling(taskId: string, intervalMs: number = 10000) {
  const [data, setData] = useState<KlingTaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/process/${taskId}`);
      if (!res.ok) throw new Error('Failed to fetch status');
      const result: KlingTaskResponse = await res.json();
      setData(result);

      if (result.status === 'succeed' || result.status === 'failed') {
        setIsPolling(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [taskId]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, intervalMs);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll, intervalMs]);

  useEffect(() => {
    if (!isPolling) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isPolling]);

  return { data, error, isPolling, elapsedSeconds };
}
