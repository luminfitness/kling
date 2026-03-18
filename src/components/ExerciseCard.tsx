'use client';

import { useState } from 'react';
import type {
  ExerciseEntry, ExerciseMetadata,
  ForceType, MechanicType, LimbType, BodyType, DifficultyType,
} from '@/types';
import {
  FORCE_OPTIONS, MECHANIC_OPTIONS, LIMB_OPTIONS, BODY_OPTIONS, DIFFICULTY_OPTIONS, MUSCLE_OPTIONS,
} from '@/types';

interface ExerciseCardProps {
  exercise: ExerciseEntry;
  onUpdate: (id: string, updates: Partial<Pick<ExerciseEntry, 'exerciseName' | 'equipmentType'> & ExerciseMetadata>) => void;
  onDelete: () => void;
  onThumbnailClick: () => void;
  onRerun?: () => void;
  equipmentOptions?: string[];
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

const EQUIPMENT_COLORS: Record<string, string> = {
  'Barbell': 'bg-orange-100 text-orange-700',
  'Dumbbell': 'bg-blue-100 text-blue-700',
  'Two Dumbbells': 'bg-indigo-100 text-indigo-700',
  'Kettlebell': 'bg-purple-100 text-purple-700',
  'TRX': 'bg-yellow-100 text-yellow-700',
};

export default function ExerciseCard({
  exercise,
  onUpdate,
  onDelete,
  onThumbnailClick,
  onRerun,
  equipmentOptions = [],
  isSelected,
  onToggleSelect,
}: ExerciseCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(exercise.exerciseName);
  const [editEquipment, setEditEquipment] = useState(exercise.equipmentType);
  const [editForce, setEditForce] = useState<ForceType | ''>(exercise.force || '');
  const [editMechanic, setEditMechanic] = useState<MechanicType[]>(exercise.mechanic || []);
  const [editLimbs, setEditLimbs] = useState<LimbType | ''>(exercise.limbs || '');
  const [editBody, setEditBody] = useState<BodyType | ''>(exercise.body || '');
  const [editDifficulty, setEditDifficulty] = useState<DifficultyType | ''>(exercise.difficulty || '');
  const [editMuscles, setEditMuscles] = useState<string[]>(exercise.musclesTargeted || []);
  const [showMuscleDropdown, setShowMuscleDropdown] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleSaveEdit = () => {
    if (!editName.trim()) return;
    onUpdate(exercise.id, {
      exerciseName: editName.trim(),
      equipmentType: editEquipment,
      force: editForce || undefined,
      mechanic: editMechanic.length > 0 ? editMechanic : undefined,
      limbs: editLimbs || undefined,
      body: editBody || undefined,
      difficulty: editDifficulty || undefined,
      musclesTargeted: editMuscles.length > 0 ? editMuscles : undefined,
    });
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditName(exercise.exerciseName);
    setEditEquipment(exercise.equipmentType);
    setEditForce(exercise.force || '');
    setEditMechanic(exercise.mechanic || []);
    setEditLimbs(exercise.limbs || '');
    setEditBody(exercise.body || '');
    setEditDifficulty(exercise.difficulty || '');
    setEditMuscles(exercise.musclesTargeted || []);
    setShowMuscleDropdown(false);
    setEditing(false);
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(exercise.outputVideoUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exercise.exerciseName.replace(/\s+/g, '-').toLowerCase()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(exercise.outputVideoUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  if (editing) {
    return (
      <div className="rounded-xl border-2 border-blue-200 bg-white p-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-black">
            <video src={exercise.outputVideoUrl} preload="metadata" muted className="h-full w-full object-cover" />
          </div>
          <div className="flex-1 space-y-3">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            <select
              value={editEquipment}
              onChange={(e) => setEditEquipment(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              {equipmentOptions.map((eq) => (
                <option key={eq} value={eq}>{eq}</option>
              ))}
            </select>

            {/* Metadata fields */}
            <div className="space-y-2 border-t border-gray-100 pt-2">
              <p className="text-xs font-medium text-gray-500">Exercise Details</p>

              {/* Force */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 w-14 shrink-0">Force</span>
                <div className="flex gap-1">
                  {FORCE_OPTIONS.map((opt) => (
                    <button key={opt} type="button" onClick={() => setEditForce(editForce === opt ? '' : opt)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${editForce === opt ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{opt}</button>
                  ))}
                </div>
              </div>

              {/* Mechanic */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 w-14 shrink-0">Mechanic</span>
                <div className="flex gap-1">
                  {MECHANIC_OPTIONS.map((opt) => (
                    <button key={opt} type="button" onClick={() => setEditMechanic(
                      editMechanic.includes(opt) ? editMechanic.filter((m) => m !== opt) : [...editMechanic, opt]
                    )}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${editMechanic.includes(opt) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{opt}</button>
                  ))}
                </div>
              </div>

              {/* Limbs */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 w-14 shrink-0">Limbs</span>
                <div className="flex gap-1">
                  {LIMB_OPTIONS.map((opt) => (
                    <button key={opt} type="button" onClick={() => setEditLimbs(editLimbs === opt ? '' : opt)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${editLimbs === opt ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{opt}</button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 w-14 shrink-0">Body</span>
                <div className="flex gap-1">
                  {BODY_OPTIONS.map((opt) => (
                    <button key={opt} type="button" onClick={() => setEditBody(editBody === opt ? '' : opt)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${editBody === opt ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{opt}</button>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-400 w-14 shrink-0">Difficulty</span>
                <div className="flex gap-1">
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <button key={opt} type="button" onClick={() => setEditDifficulty(editDifficulty === opt ? '' : opt)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${editDifficulty === opt ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{opt}</button>
                  ))}
                </div>
              </div>

              {/* Muscles */}
              <div className="flex items-start gap-1.5">
                <span className="text-[11px] text-gray-400 w-14 shrink-0 pt-1">Muscles</span>
                <div className="flex-1">
                  <button type="button" onClick={() => setShowMuscleDropdown(!showMuscleDropdown)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-[11px] text-left flex items-center justify-between hover:bg-gray-50"
                  >
                    <span className={editMuscles.length > 0 ? 'text-gray-900' : 'text-gray-400'}>
                      {editMuscles.length > 0 ? `${editMuscles.length} selected` : 'Select muscles...'}
                    </span>
                    <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showMuscleDropdown && (
                    <div className="absolute z-10 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {MUSCLE_OPTIONS.map((muscle) => (
                        <label key={muscle} className="flex items-center px-2 py-1 hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox" checked={editMuscles.includes(muscle)}
                            onChange={() => setEditMuscles(
                              editMuscles.includes(muscle) ? editMuscles.filter((m) => m !== muscle) : [...editMuscles, muscle]
                            )}
                            className="mr-1.5 h-3 w-3"
                          />
                          <span className="text-[11px] text-gray-700">{muscle}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {editMuscles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {editMuscles.map((muscle) => (
                        <span key={muscle} className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                          {muscle}
                          <button type="button" onClick={() => setEditMuscles(editMuscles.filter((m) => m !== muscle))} className="text-blue-400 hover:text-blue-600">&times;</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleSaveEdit}
              disabled={!editName.trim()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              Save
            </button>
            <button
              onClick={handleCancelEdit}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-4 rounded-xl border p-3 transition-all hover:shadow-sm ${
      isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
    }`}>
      {/* Selection checkbox */}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
        />
      )}

      {/* Clickable thumbnail */}
      <button
        onClick={onThumbnailClick}
        className="h-14 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-black transition-opacity hover:opacity-80"
      >
        <video src={exercise.outputVideoUrl} preload="metadata" muted className="h-full w-full object-cover" />
      </button>

      {/* Name + badge */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-gray-900">
            {exercise.exerciseName}
          </h3>
          {exercise.rerunning && (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
              Rerunning
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              EQUIPMENT_COLORS[exercise.equipmentType] || 'bg-gray-100 text-gray-700'
            }`}
          >
            {exercise.equipmentType}
          </span>
          <span className="text-[11px] text-gray-400">{exercise.positionName}</span>
          {exercise.force && (
            <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">{exercise.force}</span>
          )}
          {exercise.mechanic?.map((m) => (
            <span key={m} className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-600">{m}</span>
          ))}
          {exercise.difficulty && (
            <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-600">{exercise.difficulty}</span>
          )}
          {exercise.body && (
            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">{exercise.body}</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {/* Processing duration */}
        {exercise.processingDurationSec != null && (
          <span className="text-[11px] text-gray-400 mr-1" title="Processing time">
            {exercise.processingDurationSec >= 3600
              ? `${Math.floor(exercise.processingDurationSec / 3600)}h ${Math.floor((exercise.processingDurationSec % 3600) / 60)}m`
              : exercise.processingDurationSec >= 60
              ? `${Math.floor(exercise.processingDurationSec / 60)}m ${exercise.processingDurationSec % 60}s`
              : `${exercise.processingDurationSec}s`}
          </span>
        )}

        {/* Download */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Download"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>

        {/* Re-run */}
        {onRerun && (
          <button
            onClick={onRerun}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
            title="Re-run"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}

        {/* Edit */}
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Edit"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
          title="Delete"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
