'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useProjects } from '@/hooks/useProjects';
import ProjectExerciseTable from '@/components/ProjectExerciseTable';
import ExerciseCardGrid from '@/components/ExerciseCardGrid';
import VideoModal from '@/components/VideoModal';
import TrimDownloadModal from '@/components/TrimDownloadModal';
import { downloadProjectAsZip } from '@/lib/downloadProject';
import type { ExerciseEntry, Project } from '@/types';

type ViewMode = 'list' | 'grid';

interface DownloadProgress {
  isDownloading: boolean;
  current: number;
  total: number;
  currentName: string;
}

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { id: projectId } = params;
  const { projects, getProjectExercises, removeExerciseFromProject, updateProject } = useProjects();

  const [project, setProject] = useState<Project | null>(null);
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalExercise, setModalExercise] = useState<ExerciseEntry | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  // Sorting (simplified for project view)
  const [sortColumn, setSortColumn] = useState<'name' | 'equipment' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // Selection for batch trim
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
  // Download progress
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    isDownloading: false,
    current: 0,
    total: 0,
    currentName: '',
  });
  // Trim download modal - exercises to trim
  const [exercisesToTrim, setExercisesToTrim] = useState<ExerciseEntry[] | null>(null);

  const loadProjectExercises = useCallback(async () => {
    const projectData = projects.find((p) => p.id === projectId);
    if (projectData) {
      setProject(projectData);
      setEditName(projectData.name);
      setEditDescription(projectData.description || '');
    }

    const exercises = await getProjectExercises(projectId);
    setExercises(exercises);
    setLoading(false);
  }, [projectId, projects, getProjectExercises]);

  useEffect(() => {
    loadProjectExercises();
  }, [loadProjectExercises]);

  const handleRemoveFromProject = async (exerciseId: string) => {
    await removeExerciseFromProject(projectId, exerciseId);
    setExercises((prev) => prev.filter((e) => e.id !== exerciseId));
    setSelectedExercises((prev) => {
      const newSet = new Set(prev);
      newSet.delete(exerciseId);
      return newSet;
    });
  };

  const handleSaveProjectDetails = async () => {
    if (!project || !editName.trim()) return;

    await updateProject(project.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined,
    });

    setProject((prev) =>
      prev
        ? { ...prev, name: editName.trim(), description: editDescription.trim() || undefined }
        : null
    );
    setIsEditing(false);
  };

  const handleSort = (column: 'name' | 'equipment') => {
    if (sortColumn === column) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleTrimSelected = () => {
    const selectedList = exercises.filter(e => selectedExercises.has(e.id) && e.outputVideoUrl);
    if (selectedList.length === 0) {
      alert('No videos selected to trim');
      return;
    }
    setExercisesToTrim(selectedList);
  };

  const handleDownloadAll = async () => {
    if (!project || exercises.length === 0) return;

    const exercisesWithVideos = exercises.filter(e => e.outputVideoUrl);
    if (exercisesWithVideos.length === 0) {
      alert('No videos to download');
      return;
    }

    setDownloadProgress({
      isDownloading: true,
      current: 0,
      total: exercisesWithVideos.length,
      currentName: 'Starting...',
    });

    try {
      await downloadProjectAsZip(
        project.name,
        exercisesWithVideos,
        (current, total, currentName) => {
          setDownloadProgress({
            isDownloading: true,
            current,
            total,
            currentName,
          });
        }
      );
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed. Please try again.');
    } finally {
      setDownloadProgress({
        isDownloading: false,
        current: 0,
        total: 0,
        currentName: '',
      });
    }
  };

  // Sort exercises (simplified for project view)
  const sortedExercises = [...exercises].sort((a, b) => {
    if (!sortColumn) return 0;
    let cmp = 0;
    if (sortColumn === 'name') {
      cmp = (a.exerciseName || '').localeCompare(b.exerciseName || '');
    } else if (sortColumn === 'equipment') {
      cmp = (a.equipmentType || '').localeCompare(b.equipmentType || '');
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Loading project...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <p className="text-sm text-gray-400 mb-3">Project not found</p>
        <Link href="/projects" className="text-sm font-medium text-blue-600 hover:text-blue-700">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href="/projects" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Projects
        </Link>
      </div>

      {/* Header */}
      <div className="mb-5">
        {isEditing ? (
          <div className="space-y-3">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none w-full"
              autoFocus
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Project description (optional)"
              rows={2}
              className="text-sm text-gray-500 bg-transparent border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveProjectDetails}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditName(project.name);
                  setEditDescription(project.description || '');
                }}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
              {project.description && (
                <p className="text-sm text-gray-500 mt-1">{project.description}</p>
              )}
              <p className="text-sm text-gray-400 mt-2">
                {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Action buttons */}
              {exercises.length > 0 && (
                <>
                  {/* Trim Selected - only shows when exercises are selected */}
                  {selectedExercises.size > 0 && (
                    <button
                      onClick={handleTrimSelected}
                      disabled={downloadProgress.isDownloading || exercisesToTrim !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Trim selected videos and download as ZIP"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                      </svg>
                      Trim Selected ({selectedExercises.size})
                    </button>
                  )}

                  {/* Download All button */}
                  <button
                    onClick={handleDownloadAll}
                    disabled={downloadProgress.isDownloading || exercisesToTrim !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Download all videos as ZIP"
                  >
                    {downloadProgress.isDownloading ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    )}
                    Download All
                  </button>
                </>
              )}

              {/* View Mode Toggle */}
              <div className="flex items-center bg-gray-100 rounded-full p-0.5">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    viewMode === 'list'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="List view"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="Grid view"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
              </div>

              {/* Edit button */}
              <button
                onClick={() => setIsEditing(true)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Edit project"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Exercises */}
      {exercises.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-sm text-gray-400 mb-2">No exercises in this project yet</p>
          <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Go to Library to add exercises
          </Link>
        </div>
      ) : viewMode === 'list' ? (
        <ProjectExerciseTable
          exercises={sortedExercises}
          onViewVideo={(exercise) => setModalExercise(exercise)}
          onRemove={handleRemoveFromProject}
          selectedIds={selectedExercises}
          onSelectionChange={setSelectedExercises}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
        />
      ) : (
        <div>
          {/* Grid view toolbar */}
          <div className="flex items-center justify-between mb-4 px-1">
            <span className="text-sm font-semibold text-gray-700">
              {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Sort by:</span>
              <select
                value={sortColumn || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'name' || val === 'equipment') {
                    setSortColumn(val);
                    setSortDirection('asc');
                  } else {
                    setSortColumn(null);
                  }
                }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Default</option>
                <option value="name">Name</option>
                <option value="equipment">Equipment</option>
              </select>
              {sortColumn && (
                <button
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                  title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              )}
            </div>
          </div>

          {/* Card grid */}
          <ExerciseCardGrid
            exercises={sortedExercises}
            onViewVideo={(exercise) => setModalExercise(exercise)}
            selectedIds={selectedExercises}
            onSelectionChange={setSelectedExercises}
          />
        </div>
      )}

      {/* Note about selection */}
      {exercises.length > 0 && (
        <p className="mt-4 text-xs text-gray-400 text-center">
          {viewMode === 'list'
            ? 'Click to select exercises, Cmd+click for multiple. Select exercises then click "Trim Selected" to download trimmed videos.'
            : 'Double-click a card to view the video. Click to select, Cmd+click for multiple.'}
        </p>
      )}

      {/* Video Modal */}
      {modalExercise && (
        <VideoModal
          exercise={modalExercise}
          onClose={() => setModalExercise(null)}
        />
      )}

      {/* Trim Download Modal */}
      {project && exercisesToTrim !== null && (
        <TrimDownloadModal
          isOpen={true}
          onClose={() => {
            setExercisesToTrim(null);
            setSelectedExercises(new Set());
          }}
          projectName={project.name}
          exercises={exercisesToTrim}
        />
      )}

      {/* Download Progress Modal */}
      {downloadProgress.isDownloading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Downloading Videos</h3>

            {/* Progress bar */}
            <div className="mb-3">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${downloadProgress.total > 0 ? (downloadProgress.current / downloadProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>

            <p className="text-sm text-gray-600">
              {downloadProgress.current} of {downloadProgress.total} videos
            </p>
            <p className="text-xs text-gray-500 mt-1 truncate">
              {downloadProgress.currentName}
            </p>

            <p className="text-xs text-gray-400 mt-4">
              Videos will be organized by equipment type in the ZIP file.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
