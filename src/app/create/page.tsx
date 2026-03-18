'use client';

import { useState } from 'react';
import VideoInput from '@/components/VideoInput';
import { usePositions } from '@/hooks/usePositions';
import { useEquipment } from '@/hooks/useEquipment';
import { savePendingTask } from '@/lib/pendingTask';
import { addTask } from '@/lib/taskQueue';
import { getActivePrompt } from '@/lib/promptConfig';

export default function HomePage() {
  const { positions, loading: positionsLoading, getPositionImageUrl } = usePositions();
  const { allEquipmentNames, loading: equipmentLoading } = useEquipment();

  // Form state
  const [exerciseName, setExerciseName] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string>('');
  const [equipmentType, setEquipmentType] = useState('Barbell');
  const [characterOrientation, setCharacterOrientation] = useState<'image' | 'video'>('video');
  const [mode, setMode] = useState<'std' | 'pro'>('std');

  // Process state
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // UI state
  const [showPromptInfo, setShowPromptInfo] = useState(false);

  const canProcess =
    exerciseName.trim() &&
    videoUrl &&
    selectedPositionId &&
    !processing;

  const handleProcess = async () => {
    if (!videoUrl || !selectedPositionId || !exerciseName.trim()) return;
    setProcessing(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // Get the position image URL directly
      const imageUrl = getPositionImageUrl(selectedPositionId);
      if (!imageUrl) {
        throw new Error(
          `No image found for this position. Please add one via the Manage Positions button in the nav bar.`
        );
      }

      // Submit to Kling API with prompt
      const processRes = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          videoUrl,
          characterOrientation,
          mode,
          keepOriginalSound: 'yes',
          prompt: getActivePrompt(),
        }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) throw new Error(processData.error || 'Processing failed');

      // Save metadata
      const selectedPosition = positions.find((p) => p.id === selectedPositionId);
      const positionName = selectedPosition?.name || 'Unknown';
      const now = new Date().toISOString();

      savePendingTask({
        taskId: processData.taskId,
        videoUrl,
        positionId: selectedPositionId,
        positionName,
        mode,
        exerciseName: exerciseName.trim(),
        equipmentType,
        createdAt: now,
      });

      // Add to task queue (includes all data needed for auto-save)
      await addTask({
        taskId: processData.taskId,
        status: 'submitted',
        videoUrl,
        positionId: selectedPositionId,
        positionName,
        mode,
        exerciseName: exerciseName.trim(),
        equipmentType,
        startedAt: now,
      });

      // Reset form + show success
      setExerciseName('');
      setVideoUrl(null);
      setSelectedPositionId('');
      setEquipmentType('Barbell');
      setSuccessMsg('Task submitted! Track progress in Queue.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setProcessing(false);
    }
  };

  const getMissingHint = () => {
    const missing: string[] = [];
    if (!exerciseName.trim()) missing.push('exercise name');
    if (!videoUrl) missing.push('video');
    if (!selectedPositionId) missing.push('position');
    if (missing.length === 0) return '';
    return `Add ${missing.join(' and ')} to continue`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-gray-900">
          Transform Exercise Videos
        </h1>
        <p className="text-sm text-gray-500">
          Upload a reference exercise video and select an avatar to generate a
          transformed version.
        </p>
      </div>

      {/* Success message */}
      {successMsg && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      {/* Exercise Name */}
      <section>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Exercise Name
        </label>
        <input
          type="text"
          value={exerciseName}
          onChange={(e) => setExerciseName(e.target.value)}
          placeholder="e.g. Goblet Squat, Bicep Curl..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </section>

      {/* Video Input */}
      <section>
        <VideoInput onVideoReady={setVideoUrl} />
      </section>

      {/* Position & Equipment dropdowns */}
      <section>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Position
            </label>
            <select
              value={selectedPositionId}
              onChange={(e) => setSelectedPositionId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select a position...</option>
              {positionsLoading ? (
                <option disabled>Loading...</option>
              ) : (
                positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
            {positions.length === 0 && !positionsLoading && (
              <p className="mt-1 text-xs text-gray-400">
                No positions yet. Create one using the button in the nav bar.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Equipment
            </label>
            <select
              value={equipmentType}
              onChange={(e) => setEquipmentType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              {equipmentLoading ? (
                <option disabled>Loading...</option>
              ) : (
                allEquipmentNames.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      </section>

      {/* Options */}
      <section>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Character Orientation
            </label>
            <select
              value={characterOrientation}
              onChange={(e) => setCharacterOrientation(e.target.value as 'image' | 'video')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="video">Match video (up to 30s)</option>
              <option value="image">Match image (up to 10s)</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Quality Mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'std' | 'pro')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="std">Standard (faster)</option>
              <option value="pro">Professional (higher quality)</option>
            </select>
          </div>
        </div>
      </section>

      {/* AI Prompt Info (Developer View) */}
      <section className="rounded-lg border border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={() => setShowPromptInfo(!showPromptInfo)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-100 transition-colors rounded-lg"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-gray-700">AI Prompt Configuration</span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Developer Info</span>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 text-gray-400 transition-transform ${showPromptInfo ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showPromptInfo && (
          <div className="border-t border-gray-200 px-4 py-3 space-y-2">
            <p className="text-xs text-gray-500">
              This prompt is sent to Kling AI to guide video generation. It helps maintain pose accuracy and angle consistency.
            </p>
            <div className="rounded border border-gray-300 bg-white px-3 py-2">
              <p className="text-xs font-mono text-gray-700 leading-relaxed">
                {getActivePrompt()}
              </p>
            </div>
            <p className="text-xs text-gray-400 italic">
              To modify this prompt, edit <code className="rounded bg-gray-200 px-1 py-0.5">src/lib/promptConfig.ts</code>
            </p>
          </div>
        )}
      </section>

      {/* Submit */}
      <section className="space-y-3">
        <button
          onClick={handleProcess}
          disabled={!canProcess}
          className="w-full rounded-xl bg-blue-600 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Submitting...
            </span>
          ) : (
            'Create Exercise Video'
          )}
        </button>

        {!canProcess && !processing && (
          <p className="text-center text-xs text-gray-400">
            {getMissingHint()}
          </p>
        )}

        {error && (
          <p className="text-center text-sm text-red-600">{error}</p>
        )}
      </section>
    </div>
  );
}
