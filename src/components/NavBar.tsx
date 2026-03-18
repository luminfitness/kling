'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useQueueContext } from '@/contexts/QueueProcessorContext';
import { useExerciseLibrary } from '@/hooks/useExerciseLibrary';
import { useExerciseTemplates } from '@/hooks/useExerciseTemplates';
import { usePositions } from '@/hooks/usePositions';
import { useEquipment } from '@/hooks/useEquipment';
import { useBatchSubmission } from '@/contexts/BatchSubmissionContext';
import { hasNewExercises } from '@/lib/libraryNotification';
import PositionManagementModal from './PositionManagementModal';
import EquipmentManagementModal from './EquipmentManagementModal';
import ImportTemplatesModal from './ImportTemplatesModal';
import BatchImportVideosModal from './BatchImportVideosModal';
import BatchProgressPanel from './BatchProgressPanel';
import ActiveTasksIndicator from './ActiveTasksIndicator';
import type { ExerciseTemplate } from '@/types';

export default function NavBar() {
  const { items: submissionItems, isSubmitting } = useBatchSubmission();
  const { isProcessing } = useQueueContext();
  const { exercises } = useExerciseLibrary();
  const { templates, addTemplate, updateTemplate } = useExerciseTemplates();
  const { positions, createPosition, updatePosition, deletePosition } = usePositions();
  const { equipment, addEquipment, updateEquipment, deleteEquipment, allEquipmentNames } = useEquipment();
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);

  // Import templates handler
  const handleImportTemplates = useCallback(async (templates: Omit<ExerciseTemplate, 'id' | 'createdAt'>[]) => {
    for (const t of templates) {
      try {
        await addTemplate(t);
      } catch (err) {
        console.error(`Failed to import ${t.exerciseName}:`, err);
      }
    }
    // Refresh page to show imported templates
    window.location.href = '/';
  }, [addTemplate]);

  const pendingSubmissions = submissionItems.filter(
    (i) => i.status === 'pending'
  ).length;
  const showLibraryDot = hasNewExercises(exercises);

  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 py-3">
          <Link href="/" className="relative text-lg font-bold text-gray-900">
            Avatar Transformer
            {isProcessing || pendingSubmissions > 0 ? (
              <span className={`absolute -right-2 -top-1 h-2.5 w-2.5 rounded-full animate-pulse ${isSubmitting ? 'bg-orange-500' : 'bg-blue-600'}`} />
            ) : showLibraryDot ? (
              <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-green-500" />
            ) : null}
          </Link>

          <div className="flex items-center gap-1">
            {/* Manage Positions */}
            <button
              onClick={() => setShowPositionModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              title="Manage Positions"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Positions
            </button>

            {/* Manage Equipment */}
            <button
              onClick={() => setShowEquipmentModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              title="Manage Equipment"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              Equipment
            </button>

            {/* Tools */}
            <Link
              href="/tools"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Tools
            </Link>

            {/* Image Gen */}
            <Link
              href="/image-gen"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Image Gen
            </Link>

            {/* Loop Finder */}
            <Link
              href="/loop"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Loop
            </Link>

            {/* Import */}
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              title="Import Templates"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import
            </button>

            {/* Batch Import Videos */}
            <button
              onClick={() => setShowBatchImportModal(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              title="Batch Import Videos"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Batch Videos
            </button>

          </div>
        </div>
      </header>

      {/* Position Management Modal */}
      <PositionManagementModal
        isOpen={showPositionModal}
        onClose={() => setShowPositionModal(false)}
        positions={positions}
        equipmentOptions={allEquipmentNames}
        onCreatePosition={createPosition}
        onUpdatePosition={updatePosition}
        onDeletePosition={deletePosition}
      />

      {/* Equipment Management Modal */}
      <EquipmentManagementModal
        isOpen={showEquipmentModal}
        onClose={() => setShowEquipmentModal(false)}
        equipment={equipment}
        onAddEquipment={addEquipment}
        onUpdateEquipment={updateEquipment}
        onDeleteEquipment={deleteEquipment}
      />

      {/* Import Templates Modal */}
      <ImportTemplatesModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportTemplates}
        positions={positions}
        equipmentNames={allEquipmentNames}
        createPosition={createPosition}
        templates={templates}
        onUpdateTemplate={updateTemplate}
      />

      {/* Batch Import Videos Modal */}
      <BatchImportVideosModal
        isOpen={showBatchImportModal}
        onClose={() => setShowBatchImportModal(false)}
        templates={templates}
        positions={positions}
        onUpdateTemplate={updateTemplate}
        onAddTemplate={addTemplate}
        onCreatePosition={createPosition}
      />

      {/* Batch Progress Panel - bottom-right, persists across pages */}
      <BatchProgressPanel />

      {/* Active Tasks Indicator - shows when tasks are processing on Kling */}
      <ActiveTasksIndicator />
    </>
  );
}
