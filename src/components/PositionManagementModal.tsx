'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { Position } from '@/types';
import { Badge } from '@/components/ui/Badge';

interface PositionManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  positions: Position[];
  equipmentOptions: string[];
  onCreatePosition: (name: string, equipmentType: string, imageFile: File) => Promise<Position>;
  onUpdatePosition: (id: string, name: string, equipmentType: string, imageFile?: File) => Promise<void>;
  onDeletePosition: (id: string) => Promise<void>;
}

type ViewMode = 'list' | 'create' | 'edit';
type ImageMode = 'upload' | 'generate';
type SortOption = 'newest' | 'oldest' | 'name';

const DEFAULT_PROMPT = "Make the character in the 1st reference image be in the pose of the second photo and holding the equipment in the same way. Keep the original background of 1st reference image.";

export default function PositionManagementModal({
  isOpen,
  onClose,
  positions,
  equipmentOptions,
  onCreatePosition,
  onUpdatePosition,
  onDeletePosition,
}: PositionManagementModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [equipmentType, setEquipmentType] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // AI Generation state
  const [imageMode, setImageMode] = useState<ImageMode>('upload');
  const [ref1File, setRef1File] = useState<File | null>(null);
  const [ref1Preview, setRef1Preview] = useState<string | null>(null);
  const [ref1PositionId, setRef1PositionId] = useState<string | null>(null);
  const [ref2File, setRef2File] = useState<File | null>(null);
  const [ref2Preview, setRef2Preview] = useState<string | null>(null);
  const [ref2PositionId, setRef2PositionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [generating, setGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const ref1InputRef = useRef<HTMLInputElement | null>(null);
  const ref2InputRef = useRef<HTMLInputElement | null>(null);

  // Filter and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEquipment, setFilterEquipment] = useState<string>('');
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Filtered and sorted positions
  const filteredPositions = useMemo(() => {
    let result = [...positions];

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q));
    }

    // Filter by equipment
    if (filterEquipment) {
      result = result.filter(p => p.equipmentType === filterEquipment);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortOption) {
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return result;
  }, [positions, searchQuery, filterEquipment, sortOption]);

  // Reset to list view when modal opens
  useEffect(() => {
    if (isOpen) {
      setViewMode('list');
      setSearchQuery('');
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setName('');
    setEquipmentType('');
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setExistingImageUrl(null);
    setEditingPositionId(null);
    setSaveError(null);
    setDeleteError(null);
    // Reset AI generation state
    setImageMode('upload');
    if (ref1Preview) URL.revokeObjectURL(ref1Preview);
    if (ref2Preview) URL.revokeObjectURL(ref2Preview);
    setRef1File(null);
    setRef1Preview(null);
    setRef1PositionId(null);
    setRef2File(null);
    setRef2Preview(null);
    setRef2PositionId(null);
    setPrompt(DEFAULT_PROMPT);
    setGenerating(false);
    setGeneratedImageUrl(null);
    setGenerateError(null);
  };

  const handleImageSelect = (file: File | null) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    } else {
      setImageFile(null);
      setImagePreview(null);
    }
  };

  const handleRemoveImage = () => {
    handleImageSelect(null);
    setExistingImageUrl(null);
    setGeneratedImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Reference image handlers for AI generation
  const handleRef1Select = (file: File | null) => {
    if (ref1Preview) URL.revokeObjectURL(ref1Preview);
    setRef1PositionId(null);
    if (file) {
      setRef1File(file);
      setRef1Preview(URL.createObjectURL(file));
    } else {
      setRef1File(null);
      setRef1Preview(null);
    }
  };

  const handleRef1PositionSelect = (positionId: string) => {
    if (ref1Preview) URL.revokeObjectURL(ref1Preview);
    setRef1File(null);
    setRef1PositionId(positionId);
    const pos = positions.find(p => p.id === positionId);
    setRef1Preview(pos?.publicUrl || null);
  };

  const handleRef2Select = (file: File | null) => {
    if (ref2Preview) URL.revokeObjectURL(ref2Preview);
    setRef2PositionId(null);
    if (file) {
      setRef2File(file);
      setRef2Preview(URL.createObjectURL(file));
    } else {
      setRef2File(null);
      setRef2Preview(null);
    }
  };

  const handleRef2PositionSelect = (positionId: string) => {
    if (ref2Preview) URL.revokeObjectURL(ref2Preview);
    setRef2File(null);
    setRef2PositionId(positionId);
    const pos = positions.find(p => p.id === positionId);
    setRef2Preview(pos?.publicUrl || null);
  };

  // Generate image with AI
  const handleGenerate = async () => {
    if (!ref1Preview || !ref2Preview) return;

    setGenerating(true);
    setGenerateError(null);
    setGeneratedImageUrl(null);

    try {
      // Convert files to base64 or use URLs
      let ref1Data: string;
      let ref2Data: string;

      if (ref1File) {
        ref1Data = await fileToBase64(ref1File);
      } else if (ref1PositionId) {
        const pos = positions.find(p => p.id === ref1PositionId);
        ref1Data = pos?.publicUrl || '';
      } else {
        throw new Error('Reference image 1 is required');
      }

      if (ref2File) {
        ref2Data = await fileToBase64(ref2File);
      } else if (ref2PositionId) {
        const pos = positions.find(p => p.id === ref2PositionId);
        ref2Data = pos?.publicUrl || '';
      } else {
        throw new Error('Reference image 2 is required');
      }

      const response = await fetch('/api/generate-position-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImage1: ref1Data,
          referenceImage2: ref2Data,
          prompt,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate image');
      }

      setGeneratedImageUrl(data.imageUrl);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate image');
    } finally {
      setGenerating(false);
    }
  };

  // Use generated image
  const handleUseGeneratedImage = async () => {
    if (!generatedImageUrl) return;

    // Fetch the generated image and convert to File
    try {
      const response = await fetch(generatedImageUrl);
      const blob = await response.blob();
      const file = new File([blob], 'generated-position.png', { type: 'image/png' });
      handleImageSelect(file);
      setImageMode('upload'); // Switch back to upload tab to show the result
    } catch (err) {
      console.error('Failed to use generated image:', err);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !equipmentType || !imageFile) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onCreatePosition(name.trim(), equipmentType, imageFile);
      resetForm();
      setViewMode('list');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to create position');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingPositionId || !name.trim() || !equipmentType) return;
    if (!existingImageUrl && !imageFile) return;

    setSaving(true);
    setSaveError(null);
    try {
      await onUpdatePosition(editingPositionId, name.trim(), equipmentType, imageFile || undefined);
      resetForm();
      setViewMode('list');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update position');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this position? This cannot be undone.')) return;
    setDeleteError(null);
    try {
      await onDeletePosition(id);
    } catch (err) {
      console.error('Failed to delete position:', err);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete position');
    }
  };

  const handleStartEdit = (position: Position) => {
    setEditingPositionId(position.id);
    setName(position.name);
    setEquipmentType(position.equipmentType);
    setExistingImageUrl(position.publicUrl);
    setViewMode('edit');
  };

  const handleStartCreate = () => {
    resetForm();
    setViewMode('create');
  };

  const handleCancel = () => {
    resetForm();
    setViewMode('list');
  };

  if (!isOpen) return null;

  const hasImage = !!(imagePreview || existingImageUrl);
  const displayImageUrl = imagePreview || existingImageUrl;
  const canCreate = name.trim() && equipmentType && hasImage;
  const canUpdate = name.trim() && equipmentType && hasImage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-5xl rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {viewMode === 'list' && 'Manage Positions'}
            {viewMode === 'create' && 'Create New Position'}
            {viewMode === 'edit' && 'Edit Position'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Delete Error */}
        {deleteError && viewMode === 'list' && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{deleteError}</p>
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="space-y-4">
            {/* Create button at top */}
            <button
              onClick={handleStartCreate}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              + Create New Position
            </button>

            {positions.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500">No positions yet. Create your first position to get started.</p>
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search positions..."
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Filter and Sort Controls */}
                <div className="flex gap-3 items-center">
                  {/* Equipment Filter */}
                  <div className="flex-1">
                    <select
                      value={filterEquipment}
                      onChange={(e) => setFilterEquipment(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">All Equipment</option>
                      {equipmentOptions.map((eq) => (
                        <option key={eq} value={eq}>{eq}</option>
                      ))}
                    </select>
                  </div>

                  {/* Sort */}
                  <div className="flex-1">
                    <select
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value as SortOption)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                      <option value="name">Name A-Z</option>
                    </select>
                  </div>
                </div>

                {/* Position count */}
                <p className="text-xs text-gray-500">
                  {filteredPositions.length} position{filteredPositions.length !== 1 ? 's' : ''}
                  {filterEquipment && ` for ${filterEquipment}`}
                </p>

                {/* Positions grid */}
                <div className="grid grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto pr-1">
                  {filteredPositions.map((position) => (
                    <div
                      key={position.id}
                      className="group relative overflow-hidden rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                    >
                      {/* Image */}
                      <button
                        className="w-full"
                        onClick={() => setPreviewImageUrl(position.publicUrl)}
                      >
                        <img
                          src={position.publicUrl}
                          alt={position.name}
                          className="aspect-[9/16] w-full object-cover object-top"
                        />
                      </button>
                      {/* Info */}
                      <div className="p-2">
                        <p className="truncate text-xs font-medium text-gray-900">{position.name}</p>
                        {position.equipmentType ? (
                          <p className="truncate text-xs text-gray-500">{position.equipmentType}</p>
                        ) : (
                          <p className="text-xs text-gray-400">No equipment</p>
                        )}
                        <div className="mt-1.5 flex gap-1">
                          <button
                            onClick={() => handleStartEdit(position)}
                            className="flex-1 rounded border border-gray-300 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(position.id)}
                            className="flex-1 rounded border border-red-200 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredPositions.length === 0 && (
                    <div className="col-span-4 py-8 text-center">
                      <p className="text-sm text-gray-500">
                        {filterEquipment ? `No positions found for ${filterEquipment}` : 'No positions match your search.'}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Create/Edit Form */}
        {(viewMode === 'create' || viewMode === 'edit') && (
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Position Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Standing Barbell, Seated Dumbbell Press..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Equipment */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Equipment</label>
              <select
                value={equipmentType}
                onChange={(e) => setEquipmentType(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select equipment...</option>
                {equipmentOptions.map((eq) => (
                  <option key={eq} value={eq}>{eq}</option>
                ))}
              </select>
            </div>

            {/* Image Section */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Reference Image</label>

              {/* Tab switcher */}
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setImageMode('upload')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    imageMode === 'upload'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Upload
                </button>
                <button
                  onClick={() => setImageMode('generate')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    imageMode === 'generate'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Generate with AI
                </button>
              </div>

              {/* Upload Tab */}
              {imageMode === 'upload' && (
                <>
                  {hasImage ? (
                    <div className="flex items-center gap-4 rounded-lg border border-gray-200 p-4">
                      <img src={displayImageUrl!} alt="Position preview" className="h-24 w-24 rounded-lg border object-cover" />
                      <div className="flex-1">
                        <p className="text-sm text-gray-600">{imageFile ? imageFile.name : '(Existing image)'}</p>
                      </div>
                      <div className="flex gap-2">
                        {/* Download button */}
                        <button
                          onClick={() => downloadImage(displayImageUrl!, `${name || 'position'}-image.png`)}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-500 hover:bg-blue-200"
                          title="Download image"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                        {/* Remove button */}
                        <button
                          onClick={handleRemoveImage}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-500 hover:bg-red-200"
                          title="Remove image"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-8 w-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Click to upload image
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => handleImageSelect(e.target.files?.[0] || null)}
                  />
                </>
              )}

              {/* Generate Tab */}
              {imageMode === 'generate' && (
                <div className="space-y-4">
                  {/* Reference Image 1 */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Reference Image 1 (Character)</label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        {ref1Preview ? (
                          <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                            <img src={ref1Preview} alt="Ref 1" className="h-16 w-16 rounded border object-cover" />
                            <button
                              onClick={() => { handleRef1Select(null); setRef1PositionId(null); }}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => ref1InputRef.current?.click()}
                            className="w-full rounded-lg border-2 border-dashed border-gray-300 px-3 py-4 text-xs text-gray-500 hover:border-blue-400"
                          >
                            Drop or click to upload
                          </button>
                        )}
                        <input
                          ref={ref1InputRef}
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => handleRef1Select(e.target.files?.[0] || null)}
                        />
                      </div>
                      <div className="w-40">
                        <select
                          value={ref1PositionId || ''}
                          onChange={(e) => e.target.value && handleRef1PositionSelect(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-2 text-xs focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Or select existing...</option>
                          {positions.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Reference Image 2 */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Reference Image 2 (Pose)</label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        {ref2Preview ? (
                          <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                            <img src={ref2Preview} alt="Ref 2" className="h-16 w-16 rounded border object-cover" />
                            <button
                              onClick={() => { handleRef2Select(null); setRef2PositionId(null); }}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => ref2InputRef.current?.click()}
                            className="w-full rounded-lg border-2 border-dashed border-gray-300 px-3 py-4 text-xs text-gray-500 hover:border-blue-400"
                          >
                            Drop or click to upload
                          </button>
                        )}
                        <input
                          ref={ref2InputRef}
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => handleRef2Select(e.target.files?.[0] || null)}
                        />
                      </div>
                      <div className="w-40">
                        <select
                          value={ref2PositionId || ''}
                          onChange={(e) => e.target.value && handleRef2PositionSelect(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-2 text-xs focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Or select existing...</option>
                          {positions.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Prompt */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Prompt</label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Generate button */}
                  <button
                    onClick={handleGenerate}
                    disabled={!ref1Preview || !ref2Preview || generating}
                    className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {generating ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Generating...
                      </span>
                    ) : (
                      'Generate Image'
                    )}
                  </button>

                  {/* Generate Error */}
                  {generateError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                      <p className="text-sm text-red-700">{generateError}</p>
                    </div>
                  )}

                  {/* Generated Result */}
                  {generatedImageUrl && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                      <p className="text-xs font-medium text-green-700 mb-2">Generated Image</p>
                      <div className="flex items-center gap-4">
                        <img src={generatedImageUrl} alt="Generated" className="h-32 w-32 rounded-lg border object-cover" />
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => downloadImage(generatedImageUrl, `generated-${name || 'position'}.png`)}
                            className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
                          >
                            Download
                          </button>
                          <button
                            onClick={handleGenerate}
                            disabled={generating}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Retry
                          </button>
                          <button
                            onClick={handleUseGeneratedImage}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                          >
                            Use This Image
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Save Error */}
            {saveError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700">{saveError}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCancel}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={viewMode === 'create' ? handleCreate : handleUpdate}
                disabled={viewMode === 'create' ? !canCreate : !canUpdate || saving}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving ? 'Saving...' : viewMode === 'create' ? 'Create Position' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Full-size image preview */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={() => setPreviewImageUrl(null)}
        >
          <img
            src={previewImageUrl}
            alt="Position preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}

// Helper to convert File to base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper to download an image
async function downloadImage(url: string, filename: string) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Failed to download image:', err);
  }
}
