'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useExerciseLibrary } from '@/hooks/useExerciseLibrary';
import { useExerciseTemplates } from '@/hooks/useExerciseTemplates';
import { usePositions } from '@/hooks/usePositions';
import ExerciseCard from '@/components/ExerciseCard';
import VideoModal from '@/components/VideoModal';
import ExerciseTemplateModal from '@/components/ExerciseTemplateModal';
import AddToProjectModal from '@/components/AddToProjectModal';
import { setLastLibraryViewedAt } from '@/lib/libraryNotification';
import { useEquipment } from '@/hooks/useEquipment';
import type { ExerciseEntry, ExerciseTemplate } from '@/types';

export default function LibraryPage() {
  const router = useRouter();
  const { exercises, loading: loadingExercises, updateExercise, deleteExercise, saveExercise, reloadExercises } = useExerciseLibrary();
  const { templates, addTemplate, updateTemplate, deleteTemplate, getTemplate } = useExerciseTemplates();
  const { positions } = usePositions();
  const { allEquipmentNames } = useEquipment();

  const [search, setSearch] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState<string[]>([]);
  const [positionFilter, setPositionFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const [modalExercise, setModalExercise] = useState<ExerciseEntry | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ExerciseTemplate | null>(null);
  const [templateModalMode, setTemplateModalMode] = useState<'create' | 'edit'>('create');

  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
  const [showAddToProjectModal, setShowAddToProjectModal] = useState(false);
  const [showEquipmentDropdown, setShowEquipmentDropdown] = useState(false);
  const [showPositionDropdown, setShowPositionDropdown] = useState(false);

  // Clear the library notification dot when visiting this page
  useEffect(() => {
    setLastLibraryViewedAt(new Date().toISOString());
  }, []);

  // Combined filtering
  const filteredTemplates = useMemo(() => {
    if (statusFilter === 'completed') return [];

    let result = [...templates];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        t.exerciseName.toLowerCase().includes(q)
      );
    }

    // Equipment filter
    if (equipmentFilter.length > 0) {
      result = result.filter((t) => equipmentFilter.includes(t.equipmentType));
    }

    // Position filter
    if (positionFilter) {
      result = result.filter((t) => t.positionId === positionFilter);
    }

    // Sort
    result.sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return sortOrder === 'newest' ? db - da : da - db;
    });

    return result;
  }, [templates, search, equipmentFilter, positionFilter, sortOrder, statusFilter]);

  const filteredExercises = useMemo(() => {
    if (statusFilter === 'pending') return [];

    let result = [...exercises];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) =>
        e.exerciseName.toLowerCase().includes(q)
      );
    }

    // Equipment filter
    if (equipmentFilter.length > 0) {
      result = result.filter((e) => equipmentFilter.includes(e.equipmentType));
    }

    // Position filter
    if (positionFilter) {
      result = result.filter((e) => e.positionId === positionFilter);
    }

    // Sort
    result.sort((a, b) => {
      const da = new Date(a.savedAt).getTime();
      const db = new Date(b.savedAt).getTime();
      return sortOrder === 'newest' ? db - da : da - db;
    });

    return result;
  }, [exercises, search, equipmentFilter, positionFilter, sortOrder, statusFilter]);

  const totalCost = exercises.reduce((sum, e) => sum + (e.costUsd || 0), 0);
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

  const handleRerunExercise = async (exercise: ExerciseEntry) => {
    // Create a new template from the completed exercise and add to pending
    // Input video is already trimmed, so use full duration (no re-trimming needed)
    await addTemplate({
      exerciseName: exercise.exerciseName,
      equipmentType: exercise.equipmentType,
      inputVideoUrl: exercise.inputVideoUrl,
      positionId: exercise.positionId,
      positionName: exercise.positionName,
      customPrompt: exercise.customPrompt || '',
      startTime: 0,
      endTime: exercise.videoDurationSec || undefined,
      isRerun: true,
      sourceExerciseId: exercise.id,
    });
    // Mark the exercise as "rerunning" (keep it in completed table)
    await updateExercise(exercise.id, { rerunning: true });
  };

  const handleSaveTemplate = async (template: Omit<ExerciseTemplate, 'id' | 'createdAt'>) => {
    if (templateModalMode === 'edit' && editingTemplate) {
      await updateTemplate(editingTemplate.id, template);
    } else {
      await addTemplate(template);
    }
  };

  const handleToggleTemplate = (templateId: string) => {
    const newSelected = new Set(selectedTemplates);
    if (newSelected.has(templateId)) {
      newSelected.delete(templateId);
    } else {
      newSelected.add(templateId);
    }
    setSelectedTemplates(newSelected);
  };

  const handleBatchOutput = () => {
    if (selectedTemplates.size === 0) return;
    const templateIds = Array.from(selectedTemplates);
    router.push(`/queue?batch=${templateIds.join(',')}`);
  };

  const toggleEquipmentFilter = (equipment: string) => {
    setEquipmentFilter(prev =>
      prev.includes(equipment)
        ? prev.filter(e => e !== equipment)
        : [...prev, equipment]
    );
  };

  const handleToggleExercise = (exerciseId: string) => {
    const newSelected = new Set(selectedExercises);
    if (newSelected.has(exerciseId)) {
      newSelected.delete(exerciseId);
    } else {
      newSelected.add(exerciseId);
    }
    setSelectedExercises(newSelected);
  };

  const handleSelectAllExercises = () => {
    if (selectedExercises.size === filteredExercises.length) {
      setSelectedExercises(new Set());
    } else {
      setSelectedExercises(new Set(filteredExercises.map((e) => e.id)));
    }
  };

  const handleAddToProjectSuccess = () => {
    setSelectedExercises(new Set());
  };

  const loading = loadingExercises;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Loading library...</p>
      </div>
    );
  }

  const hasItems = totalItems > 0;
  const hasPendingTemplates = filteredTemplates.length > 0 && statusFilter !== 'completed';

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exercise Library</h1>
          <p className="text-sm text-gray-500">
            {templates.length} pending · {exercises.length} completed
            {totalCost > 0 && ` · $${totalCost.toFixed(2)} spent`}
          </p>
        </div>
        <button
          onClick={handleCreateTemplate}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Create New
        </button>
      </div>

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
        <>
          {/* Search + Filters */}
          <div className="mb-4 space-y-3">
            {/* Search bar */}
            <div className="relative">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exercises..."
                className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Equipment Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowEquipmentDropdown(!showEquipmentDropdown)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                >
                  Equipment {equipmentFilter.length > 0 && `(${equipmentFilter.length})`}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showEquipmentDropdown && (
                  <div className="absolute z-10 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg">
                    {allEquipmentNames.map((eq) => (
                      <label key={eq} className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={equipmentFilter.includes(eq)}
                          onChange={() => toggleEquipmentFilter(eq)}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">{eq}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Position Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowPositionDropdown(!showPositionDropdown)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                >
                  Position {positionFilter && '(1)'}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPositionDropdown && (
                  <div className="absolute z-10 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    <label className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="position"
                        checked={positionFilter === ''}
                        onChange={() => setPositionFilter('')}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">All Positions</span>
                    </label>
                    {positions.map((position) => (
                      <label key={position.id} className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="position"
                          checked={positionFilter === position.id}
                          onChange={() => setPositionFilter(position.id)}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">{position.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending Only</option>
                <option value="completed">Completed Only</option>
              </select>

              {/* Sort Order */}
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none ml-auto"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            {/* Batch Output Button */}
            {hasPendingTemplates && (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
                <span className="text-sm text-blue-900">
                  {selectedTemplates.size} template{selectedTemplates.size !== 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={handleBatchOutput}
                  disabled={selectedTemplates.size === 0}
                  className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Batch Output →
                </button>
              </div>
            )}
          </div>

          {/* Results */}
          {filteredTemplates.length === 0 && filteredExercises.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-200">
              <p className="text-sm text-gray-400">No items match your filters</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Pending Templates */}
              {filteredTemplates.length > 0 && statusFilter !== 'completed' && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-700 mb-2">
                    Pending ({filteredTemplates.length})
                  </h2>
                  <div className="space-y-2">
                    {filteredTemplates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center gap-3 p-3 border border-amber-200 bg-amber-50 rounded-lg"
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={selectedTemplates.has(template.id)}
                          onChange={() => handleToggleTemplate(template.id)}
                          className="h-4 w-4 text-blue-600 rounded"
                        />

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-900 truncate">
                            {template.exerciseName}
                          </h3>
                          <div className="flex gap-2 mt-1">
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                              {template.equipmentType}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                              {template.positionName}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 font-medium">
                              Not Processed
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditTemplate(template)}
                            className="text-blue-600 hover:text-blue-700 text-sm"
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => deleteTemplate(template.id)}
                            className="text-red-600 hover:text-red-700 text-sm"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed Exercises */}
              {filteredExercises.length > 0 && statusFilter !== 'pending' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-gray-700">
                      Completed ({filteredExercises.length})
                    </h2>
                    {filteredExercises.length > 0 && (
                      <button
                        onClick={handleSelectAllExercises}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        {selectedExercises.size === filteredExercises.length ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                  </div>

                  {/* Selection Action Bar */}
                  {selectedExercises.size > 0 && (
                    <div className="mb-3 flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg px-4 py-2">
                      <span className="text-sm text-purple-900">
                        {selectedExercises.size} exercise{selectedExercises.size !== 1 ? 's' : ''} selected
                      </span>
                      <button
                        onClick={() => setShowAddToProjectModal(true)}
                        className="px-4 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
                      >
                        Add to Project
                      </button>
                    </div>
                  )}

                  <div className="space-y-2">
                    {filteredExercises.map((exercise) => (
                      <ExerciseCard
                        key={exercise.id}
                        exercise={exercise}
                        onUpdate={updateExercise}
                        onDelete={() => deleteExercise(exercise.id)}
                        onThumbnailClick={() => setModalExercise(exercise)}
                        onRerun={() => handleRerunExercise(exercise)}
                        equipmentOptions={allEquipmentNames}
                        isSelected={selectedExercises.has(exercise.id)}
                        onToggleSelect={() => handleToggleExercise(exercise.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
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

      <AddToProjectModal
        isOpen={showAddToProjectModal}
        onClose={() => setShowAddToProjectModal(false)}
        exerciseIds={Array.from(selectedExercises)}
        onSuccess={handleAddToProjectSuccess}
      />
    </div>
  );
}
