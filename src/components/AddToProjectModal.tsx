'use client';

import { useState } from 'react';
import { useProjects } from '@/hooks/useProjects';
import type { Project } from '@/types';

interface AddToProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  exerciseIds: string[];
  onSuccess: () => void;
}

export default function AddToProjectModal({
  isOpen,
  onClose,
  exerciseIds,
  onSuccess,
}: AddToProjectModalProps) {
  const { projects, createProject, addExercisesToProject } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [adding, setAdding] = useState(false);

  if (!isOpen) return null;

  const handleAdd = async () => {
    if (!selectedProjectId && !newProjectName.trim()) return;

    setAdding(true);
    try {
      let projectId = selectedProjectId;

      // Create new project if needed
      if (!projectId && newProjectName.trim()) {
        const newProject = await createProject(newProjectName.trim());
        projectId = newProject.id;
      }

      // Add exercises to project
      await addExercisesToProject(projectId, exerciseIds);

      onSuccess();
      onClose();

      // Reset state
      setSelectedProjectId('');
      setNewProjectName('');
      setShowNewProject(false);
    } catch (error) {
      console.error('Failed to add to project:', error);
    } finally {
      setAdding(false);
    }
  };

  const handleClose = () => {
    setSelectedProjectId('');
    setNewProjectName('');
    setShowNewProject(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Add to Project</h2>
          <p className="text-sm text-gray-500 mt-1">
            {exerciseIds.length} exercise{exerciseIds.length !== 1 ? 's' : ''} selected
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Existing Projects */}
          {projects.length > 0 && !showNewProject && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Choose a project
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {projects.map((project) => (
                  <label
                    key={project.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedProjectId === project.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="project"
                      value={project.id}
                      checked={selectedProjectId === project.id}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{project.name}</p>
                      <p className="text-xs text-gray-400">
                        {project.exerciseCount || 0} exercises
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* New Project Option */}
          {!showNewProject ? (
            <button
              type="button"
              onClick={() => {
                setShowNewProject(true);
                setSelectedProjectId('');
              }}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create new project
            </button>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New project name
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g., Upper Body Exercises"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              {projects.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowNewProject(false);
                    setNewProjectName('');
                  }}
                  className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Choose existing project instead
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={(!selectedProjectId && !newProjectName.trim()) || adding}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {adding ? 'Adding...' : 'Add to Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
