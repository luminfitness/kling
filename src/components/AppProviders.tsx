'use client';

import { type ReactNode } from 'react';
import { BatchSubmissionProvider } from '@/contexts/BatchSubmissionContext';
import { QueueProcessorProvider } from '@/contexts/QueueProcessorContext';

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueueProcessorProvider>
      <BatchSubmissionProvider>{children}</BatchSubmissionProvider>
    </QueueProcessorProvider>
  );
}
