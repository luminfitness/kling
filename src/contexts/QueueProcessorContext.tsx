'use client';

import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { useQueueProcessor, type ModalState } from '@/hooks/useQueueProcessor';
import type { ExerciseTemplate } from '@/types';

interface QueueProcessorContextValue {
  // Modal state
  isProcessing: boolean;
  modalState: ModalState;

  // Actions
  processTemplates: (templates: ExerciseTemplate[]) => Promise<void>;
  cancelProcessing: () => void;
  resetModal: () => void;

  // Triggers
  exerciseSavedTrigger: number;
  templateDeletedTrigger: number;
}

const QueueProcessorContext = createContext<QueueProcessorContextValue | null>(null);

export function QueueProcessorProvider({ children }: { children: ReactNode }) {
  const queueProcessor = useQueueProcessor();

  return (
    <QueueProcessorContext.Provider value={queueProcessor}>
      {children}
    </QueueProcessorContext.Provider>
  );
}

export function useQueueContext() {
  const context = useContext(QueueProcessorContext);
  if (!context) {
    throw new Error('useQueueContext must be used within QueueProcessorProvider');
  }
  return context;
}
