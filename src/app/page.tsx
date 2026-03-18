'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import { useExerciseLibrary } from '@/hooks/useExerciseLibrary';
import { useExerciseTemplates } from '@/hooks/useExerciseTemplates';
import { usePositions } from '@/hooks/usePositions';
import { useEquipment } from '@/hooks/useEquipment';
import { useQueueContext } from '@/contexts/QueueProcessorContext';
import TemplateTable from '@/components/TemplateTable';
import ExerciseTable from '@/components/ExerciseTable';
import VideoModal from '@/components/VideoModal';
import ExerciseTemplateModal from '@/components/ExerciseTemplateModal';
import ReviewModal from '@/components/ReviewModal';
import AddToProjectModal from '@/components/AddToProjectModal';
import PositionManagementModal from '@/components/PositionManagementModal';
import CustomBatchModal from '@/components/CustomBatchModal';
import BatchAssignPositionsModal from '@/components/BatchAssignPositionsModal';
import { setLastLibraryViewedAt } from '@/lib/libraryNotification';
import type { ExerciseEntry, ExerciseTemplate } from '@/types';

export default function LibraryPage() {
  const { exercises, loading: loadingExercises, updateExercise, deleteExercise, saveExercise, reloadExercises } = useExerciseLibrary();
  const { templates, addTemplate, updateTemplate, deleteTemplate, getTemplate, reloadTemplates } = useExerciseTemplates();
  const { positions, createPosition, updatePosition, deletePosition } = usePositions();
  const { allEquipmentNames } = useEquipment();
  const {
    isProcessing,
    exerciseSavedTrigger,
    templateDeletedTrigger,
  } = useQueueContext();

  // Batch modal state (with prompt editing)
  const [customBatchModalOpen, setCustomBatchModalOpen] = useState(false);
  const [customBatchTemplates, setCustomBatchTemplates] = useState<ExerciseTemplate[]>([]);

  // Batch assign positions modal
  const [batchAssignPositionsOpen, setBatchAssignPositionsOpen] = useState(false);

  const handleBatchAssignPositions = useCallback(async (templateIds: string[], positionId: string, positionName: string) => {
    await Promise.all(templateIds.map((id) => updateTemplate(id, { positionId, positionName })));
  }, [updateTemplate]);

  // Reload exercises when a new one is auto-saved from processing
  useEffect(() => {
    if (exerciseSavedTrigger > 0) {
      console.log('[PAGE] Exercise saved trigger fired, reloading exercises...');
      reloadExercises();
    }
  }, [exerciseSavedTrigger, reloadExercises]);

  // Reload templates when they are marked as failed during processing
  useEffect(() => {
    if (templateDeletedTrigger > 0) {
      console.log('[PAGE] Template trigger fired, reloading templates...');
      reloadTemplates();
    }
  }, [templateDeletedTrigger, reloadTemplates]);

  const [tableSortColumn, setTableSortColumn] = useState<'name' | 'equipment' | 'position' | 'link' | null>(null);
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('asc');
  // Exercise table sorting
  const [exerciseSortColumn, setExerciseSortColumn] = useState<'name' | 'equipment' | 'completed' | null>(null);
  const [exerciseSortDirection, setExerciseSortDirection] = useState<'asc' | 'desc'>('asc');

  const [modalExercise, setModalExercise] = useState<ExerciseEntry | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ExerciseTemplate | null>(null);
  const [templateModalMode, setTemplateModalMode] = useState<'create' | 'edit'>('create');

  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
  const [batchSkipMessage, setBatchSkipMessage] = useState<string | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showAddToProjectModal, setShowAddToProjectModal] = useState(false);
  // Rerun note modal state
  // Position management modal state
  const [showPositionModal, setShowPositionModal] = useState(false);

  // Clear the library notification dot when visiting this page
  useEffect(() => {
    setLastLibraryViewedAt(new Date().toISOString());
  }, []);

  // Sort templates
  const sortedTemplates = useMemo(() => {
    const result = [...templates];

    // Apply table column sort if set
    if (tableSortColumn === 'name') {
      result.sort((a, b) => {
        const cmp = (a.exerciseName || '').localeCompare(b.exerciseName || '');
        return tableSortDirection === 'asc' ? cmp : -cmp;
      });
    } else if (tableSortColumn === 'equipment') {
      result.sort((a, b) => {
        const cmp = (a.equipmentType || '').localeCompare(b.equipmentType || '');
        return tableSortDirection === 'asc' ? cmp : -cmp;
      });
    } else if (tableSortColumn === 'position') {
      // Sort by whether position exists: has position first when asc
      result.sort((a, b) => {
        const aHas = a.positionName ? 1 : 0;
        const bHas = b.positionName ? 1 : 0;
        return tableSortDirection === 'asc' ? bHas - aHas : aHas - bHas;
      });
    } else if (tableSortColumn === 'link') {
      // Sort by link status: "ready" (has inputVideoUrl) before "pending" (only youtubeUrl) when asc
      result.sort((a, b) => {
        const aReady = a.inputVideoUrl ? 1 : 0;
        const bReady = b.inputVideoUrl ? 1 : 0;
        return tableSortDirection === 'asc' ? bReady - aReady : aReady - bReady;
      });
    } else {
      // Default: newest first
      result.sort((a, b) => {
        const da = new Date(a.createdAt).getTime();
        const db = new Date(b.createdAt).getTime();
        return db - da;
      });
    }

    return result;
  }, [templates, tableSortColumn, tableSortDirection]);

  const sortedExercises = useMemo(() => {
    const result = [...exercises];

    // Apply column sort if set
    if (exerciseSortColumn) {
      result.sort((a, b) => {
        let cmp = 0;
        if (exerciseSortColumn === 'name') {
          cmp = (a.exerciseName || '').localeCompare(b.exerciseName || '');
        } else if (exerciseSortColumn === 'equipment') {
          cmp = (a.equipmentType || '').localeCompare(b.equipmentType || '');
        } else if (exerciseSortColumn === 'completed') {
          cmp = new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime();
        }
        return exerciseSortDirection === 'asc' ? cmp : -cmp;
      });
    } else {
      // Default sort: unreviewed first, then newest first
      result.sort((a, b) => {
        if (a.reviewed !== b.reviewed) {
          return a.reviewed ? 1 : -1;
        }
        const da = new Date(a.savedAt).getTime();
        const db = new Date(b.savedAt).getTime();
        return db - da;
      });
    }

    return result;
  }, [exercises, exerciseSortColumn, exerciseSortDirection]);

  const totalItems = templates.length + exercises.length;

  const handleCreateTemplate = () => {
    setTemplateModalMode('create');
    setEditingTemplate(null);
    setTemplateModalOpen(true);
  };

  const handleEditTemplate = (template: ExerciseTemplate) => {
    setTemplateModalMode('edit');
    setEditingTemplate(template);
    setTemplateModalOpen(true);
  };

  // Immediately rerun exercise(s) — no note modal
  const handleRerunExercise = async (exercise: ExerciseEntry) => {
    await executeRerunList([exercise]);
  };

  const executeRerunList = async (list: ExerciseEntry[]) => {
    for (const exercise of list) {
      await addTemplate({
        exerciseName: exercise.exerciseName,
        equipmentType: exercise.equipmentType,
        inputVideoUrl: exercise.inputVideoUrl,
        positionId: exercise.positionId,
        positionName: exercise.positionName,
        customPrompt: exercise.customPrompt || '',
        isRerun: true,
        sourceExerciseId: exercise.id,
        startTime: 0,
        endTime: exercise.videoDurationSec || undefined,
      });
      await updateExercise(exercise.id, { rerunning: true });
    }
  };

  const handleSaveTemplate = async (template: Omit<ExerciseTemplate, 'id' | 'createdAt'>) => {
    if (templateModalMode === 'edit' && editingTemplate) {
      await updateTemplate(editingTemplate.id, template);
    } else {
      await addTemplate(template);
    }
  };

  const handleDuplicateTemplate = async (template: ExerciseTemplate) => {
    await addTemplate({
      exerciseName: `${template.exerciseName} (Copy)`,
      equipmentType: template.equipmentType,
      inputVideoUrl: template.inputVideoUrl,
      youtubeUrl: template.youtubeUrl,
      startTime: template.startTime,
      endTime: template.endTime,
      positionId: template.positionId,
      positionName: template.positionName,
      customPrompt: template.customPrompt,
    });
  };

  const handleAddNewTemplate = async () => {
    const defaultPosition = positions[0];
    await addTemplate({
      exerciseName: '',
      equipmentType: 'Barbell',
      positionId: defaultPosition?.id,
      positionName: defaultPosition?.name,
      startTime: 0,
      endTime: 7,
      customPrompt: '',
    });
  };

  const handleTemplateSelectionChange = useCallback((ids: Set<string>) => {
    setSelectedTemplates(ids);
  }, []);

  // Helper to check if a template is complete (ready for processing)
  const isTemplateComplete = (t: ExerciseTemplate): boolean => {
    if (!t.positionId) return false;
    if (!t.youtubeUrl && !t.inputVideoUrl) return false;
    // If video is already trimmed/uploaded (inputVideoUrl exists), start/end times aren't needed
    if (!t.inputVideoUrl) {
      if (t.startTime === undefined || t.startTime === null) return false;
      if (t.endTime === undefined || t.endTime === null) return false;
    }
    return true;
  };

  const handleBatchOutput = async () => {
    console.log('[BATCH_OUTPUT] Starting with', selectedTemplates.size, 'selected templates');
    if (selectedTemplates.size === 0) return;
    setBatchSkipMessage(null);

    const allSelected = Array.from(selectedTemplates)
      .map((id) => getTemplate(id))
      .filter((t): t is ExerciseTemplate => t !== undefined);

    console.log('[BATCH_OUTPUT] Found', allSelected.length, 'valid templates');
    if (allSelected.length === 0) return;

    // Separate complete from incomplete
    const readyToProcess = allSelected.filter(isTemplateComplete);
    const skipped = allSelected.filter((t) => !isTemplateComplete(t));

    console.log('[BATCH_OUTPUT] Ready to process:', readyToProcess.length, 'Skipped:', skipped.length);

    if (readyToProcess.length === 0) {
      setBatchSkipMessage(`Cannot process: All ${skipped.length} selected template(s) are incomplete. Each needs a position, video link, and start/end times.`);
      return;
    }

    if (skipped.length > 0) {
      const skippedNames = skipped.slice(0, 3).map((t) => t.exerciseName || 'Unnamed').join(', ');
      const moreText = skipped.length > 3 ? ` and ${skipped.length - 3} more` : '';
      setBatchSkipMessage(`Skipped ${skipped.length} incomplete template(s): ${skippedNames}${moreText}. Missing position, video, or times.`);
    }

    // Clear selection and open the batch modal (with prompt editing)
    setSelectedTemplates(new Set());

    console.log('[BATCH_OUTPUT] Opening CustomBatchModal...');
    setCustomBatchTemplates(readyToProcess);
    setCustomBatchModalOpen(true);
  };


  const handleTableSort = (column: 'name' | 'equipment' | 'position' | 'link') => {
    if (tableSortColumn === column) {
      setTableSortDirection(tableSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setTableSortColumn(column);
      setTableSortDirection('asc');
    }
  };

  const handleExerciseSort = (column: 'name' | 'equipment' | 'completed') => {
    if (exerciseSortColumn === column) {
      setExerciseSortDirection(exerciseSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setExerciseSortColumn(column);
      setExerciseSortDirection('asc');
    }
  };

  const handleExerciseSelectionChange = useCallback((ids: Set<string>) => {
    setSelectedExercises(ids);
  }, []);

  const handleAddToProject = useCallback(() => {
    if (selectedExercises.size > 0) {
      setShowAddToProjectModal(true);
    }
  }, [selectedExercises.size]);

  const handleAddToProjectSuccess = useCallback(() => {
    setSelectedExercises(new Set());
  }, []);

  const handleBulkDownload = useCallback(async () => {
    if (selectedExercises.size === 0) return;

    setIsDownloading(true);
    try {
      const zip = new JSZip();
      const selectedList = sortedExercises.filter(e => selectedExercises.has(e.id));

      for (const exercise of selectedList) {
        if (!exercise.outputVideoUrl) continue;

        try {
          const response = await fetch(exercise.outputVideoUrl);
          const blob = await response.blob();
          const filename = `${exercise.exerciseName || 'exercise'}_${exercise.equipmentType || 'unknown'}.mp4`
            .replace(/[^a-zA-Z0-9._-]/g, '_');
          zip.file(filename, blob);
        } catch (err) {
          console.error(`Failed to download ${exercise.exerciseName}:`, err);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exercises_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSelectedExercises(new Set());
    } catch (err) {
      console.error('Bulk download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  }, [selectedExercises, sortedExercises]);

  // Exercises that need review: not reviewed OR flagged (and not currently rerunning)
  const reviewableExercises = useMemo(() =>
    exercises.filter(e => (!e.reviewed || e.flagged) && !e.rerunning),
    [exercises]
  );

  const loading = loadingExercises;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Loading library...</p>
      </div>
    );
  }

  const hasItems = totalItems > 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Exercise Library</h1>
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            {templates.length} Pending
          </span>
          <span className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-medium text-green-700">
            {exercises.length} Completed
          </span>
        </div>
      </div>

      {/* Batch Skip Message Banner */}
      {batchSkipMessage && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start justify-between">
            <p className="text-sm text-amber-800">{batchSkipMessage}</p>
            <button
              onClick={() => setBatchSkipMessage(null)}
              className="ml-3 text-gray-400 hover:text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {!hasItems ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
          <p className="mb-2 text-sm text-gray-400">No exercises or templates yet</p>
          <button
            onClick={handleCreateTemplate}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Create your first exercise template
          </button>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Pending Templates — left column */}
          {sortedTemplates.length > 0 && (
            <div className="relative z-20 w-[520px] flex-shrink-0">
              <TemplateTable
                templates={sortedTemplates}
                selectedIds={selectedTemplates}
                onSelectionChange={handleTemplateSelectionChange}
                onUpdateTemplate={updateTemplate}
                onDeleteTemplate={deleteTemplate}
                onEditTemplate={handleEditTemplate}
                onDuplicateTemplate={handleDuplicateTemplate}
                onAddNewTemplate={handleAddNewTemplate}
                positions={positions}
                equipmentOptions={allEquipmentNames}
                sortColumn={tableSortColumn}
                sortDirection={tableSortDirection}
                onSort={handleTableSort}
                onBatchOutput={handleBatchOutput}
                onBatchAssignPositions={() => setBatchAssignPositionsOpen(true)}
                onCreatePosition={createPosition}
              />
            </div>
          )}

          {/* Completed Exercises — right column, matches pending table height */}
          {sortedExercises.length > 0 && (
            <div className="relative z-10 flex-1 min-w-0 flex flex-col">
              <div className="overflow-y-auto flex-1">
                <ExerciseTable
                  exercises={sortedExercises}
                  onUpdate={updateExercise}
                  onDelete={(id) => deleteExercise(id)}
                  onViewVideo={(exercise) => setModalExercise(exercise)}
                  onRerun={(exercise) => handleRerunExercise(exercise)}
                  onBulkRerun={(ids) => {
                    const selected = exercises.filter(e => ids.includes(e.id));
                    if (selected.length > 0) executeRerunList(selected);
                  }}
                  equipmentOptions={allEquipmentNames}
                  positions={positions}
                  selectedIds={selectedExercises}
                  onSelectionChange={handleExerciseSelectionChange}
                  sortColumn={exerciseSortColumn}
                  sortDirection={exerciseSortDirection}
                  onSort={handleExerciseSort}
                  onBulkDownload={handleBulkDownload}
                  onAddToProject={handleAddToProject}
                  isDownloading={isDownloading}
                  onOpenBulkReviewModal={() => setReviewModalOpen(true)}
                  reviewableCount={reviewableExercises.length}
                  onAddCustomPosition={() => setShowPositionModal(true)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {modalExercise && (
        <VideoModal
          exercise={modalExercise}
          onClose={() => setModalExercise(null)}
        />
      )}

      <ExerciseTemplateModal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onSave={handleSaveTemplate}
        onSaveToLibrary={async (params) => {
          await saveExercise(params);
          reloadExercises();
        }}
        initialData={editingTemplate || undefined}
        mode={templateModalMode}
      />

      <ReviewModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        exercises={reviewableExercises}
        onMarkReviewed={(id: string) => updateExercise(id, { reviewed: true, flagged: false })}
        onFlag={(id: string) => updateExercise(id, { flagged: true, reviewed: false })}
        onRerun={handleRerunExercise}
      />

      <AddToProjectModal
        isOpen={showAddToProjectModal}
        onClose={() => setShowAddToProjectModal(false)}
        exerciseIds={Array.from(selectedExercises)}
        onSuccess={handleAddToProjectSuccess}
      />

      <PositionManagementModal
        isOpen={showPositionModal}
        onClose={() => setShowPositionModal(false)}
        positions={positions}
        equipmentOptions={allEquipmentNames}
        onCreatePosition={createPosition}
        onUpdatePosition={updatePosition}
        onDeletePosition={deletePosition}
      />

      {batchAssignPositionsOpen && (
        <BatchAssignPositionsModal
          templates={templates}
          positions={positions}
          onClose={() => setBatchAssignPositionsOpen(false)}
          onAssign={handleBatchAssignPositions}
        />
      )}

      {/* Batch Processing Modal (with prompt editing) */}
      <CustomBatchModal
        isOpen={customBatchModalOpen}
        templates={customBatchTemplates}
        onClose={() => {
          setCustomBatchModalOpen(false);
          setCustomBatchTemplates([]);
        }}
        onComplete={() => {
          reloadExercises();
          reloadTemplates();
        }}
      />
    </div>
  );
}
