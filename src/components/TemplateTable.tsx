'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ExerciseTemplate, Position } from '@/types';
import { Badge } from './ui/Badge';
import PositionPickerModal from './PositionPickerModal';
import { downloadVideo, uploadTrimmedVideo } from '@/lib/videoDownload';
import { trimVideo } from '@/lib/videoTrimmer';


interface TemplateTableProps {
  templates: ExerciseTemplate[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onUpdateTemplate: (id: string, updates: Partial<ExerciseTemplate>) => Promise<void>;
  onDeleteTemplate: (id: string) => void;
  onEditTemplate: (template: ExerciseTemplate) => void;
  onDuplicateTemplate: (template: ExerciseTemplate) => void;
  onAddNewTemplate: () => void;
  positions: Position[];
  equipmentOptions: string[];
  // Sorting
  sortColumn: 'name' | 'equipment' | 'position' | 'link' | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: 'name' | 'equipment' | 'position' | 'link') => void;
  // Bulk actions
  onBulkEquipmentChange?: (ids: string[], equipment: string) => void;
  onBulkPositionChange?: (ids: string[], positionId: string, positionName: string) => void;
  onBulkDelete?: (ids: string[]) => void;
  onBatchOutput?: () => void;
  onBatchAssignPositions?: () => void;
  // Custom position
  onCreatePosition?: (name: string, equipmentType: string, imageFile: File) => Promise<Position>;
}

export default function TemplateTable({
  templates,
  selectedIds,
  onSelectionChange,
  onUpdateTemplate,
  onDeleteTemplate,
  onDuplicateTemplate,
  onAddNewTemplate,
  positions,
  equipmentOptions: equipmentOptionsProp,
  sortColumn,
  sortDirection,
  onSort,
  onBulkEquipmentChange,
  onBulkPositionChange,
  onBulkDelete,
  onBatchOutput,
  onBatchAssignPositions,
  onCreatePosition,
}: TemplateTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Dropdown states
  const [showEquipmentDropdown, setShowEquipmentDropdown] = useState(false);
  const [showPositionDropdown, setShowPositionDropdown] = useState(false);
  const [showRenameInput, setShowRenameInput] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [originalValue, setOriginalValue] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [positionEquipFilter, setPositionEquipFilter] = useState('All');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [uploadProcessing, setUploadProcessing] = useState<string | null>(null); // 'downloading' | 'trimming' | 'generating' | null
  const [processingTemplateId, setProcessingTemplateId] = useState<string | null>(null);
  const [linkStart, setLinkStart] = useState('');
  const [linkEnd, setLinkEnd] = useState('');
  const [linkViewMode, setLinkViewMode] = useState(false); // true = show "Video ready" summary
  const [uploadedDirectUrl, setUploadedDirectUrl] = useState<string | null>(null); // tracks file just uploaded to storage
  const [errorModal, setErrorModal] = useState<{ name: string; message: string } | null>(null);


  const equipmentRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);

  const equipmentOptions = equipmentOptionsProp.map((e) => ({ value: e, label: e }));

  // Get selected template for single-item actions
  const selectedTemplate = selectedIds.size === 1
    ? templates.find(t => selectedIds.has(t.id))
    : null;

  // Get positions filtered by equipment for selected templates
  const getFilteredPositions = () => {
    if (selectedIds.size === 1 && selectedTemplate?.equipmentType) {
      return positions.filter(p => p.equipmentType === selectedTemplate.equipmentType);
    }
    return positions;
  };

  // Handle row click for selection (Google Drive style)
  const handleRowClick = useCallback((e: React.MouseEvent, index: number, templateId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    // Prevent text selection on shift+click
    if (e.shiftKey) {
      e.preventDefault();
    }

    const isShiftKey = e.shiftKey;
    const isMetaKey = e.metaKey || e.ctrlKey;

    if (isShiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIds = templates.slice(start, end + 1).map(t => t.id);

      if (isMetaKey) {
        const newSelection = new Set(selectedIds);
        rangeIds.forEach(id => newSelection.add(id));
        onSelectionChange(newSelection);
      } else {
        onSelectionChange(new Set(rangeIds));
      }
    } else if (isMetaKey) {
      const newSelection = new Set(selectedIds);
      if (newSelection.has(templateId)) {
        newSelection.delete(templateId);
      } else {
        newSelection.add(templateId);
      }
      onSelectionChange(newSelection);
      setLastSelectedIndex(index);
    } else {
      if (selectedIds.has(templateId) && selectedIds.size === 1) {
        onSelectionChange(new Set());
        setLastSelectedIndex(null);
      } else {
        onSelectionChange(new Set([templateId]));
        setLastSelectedIndex(index);
      }
    }
  }, [templates, selectedIds, lastSelectedIndex, onSelectionChange]);

  // Clear selection on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          onSelectionChange(new Set());
          setLastSelectedIndex(null);
        }
        // Close any open dropdowns
        setShowEquipmentDropdown(false);
        setShowPositionDropdown(false);
        setShowRenameInput(false);
        setShowLinkInput(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedIds, onSelectionChange]);

  // Close dropdowns on outside click - using refs for handlers to access latest state
  const inputValueRef = useRef(inputValue);
  const showRenameInputRef = useRef(showRenameInput);
  const showLinkInputRef = useRef(showLinkInput);
  const selectedIdsRef = useRef(selectedIds);
  const selectedTemplateRef = useRef(selectedTemplate);
  const isUploadingRef = useRef(isUploading);

  // Keep refs in sync
  useEffect(() => {
    inputValueRef.current = inputValue;
    showRenameInputRef.current = showRenameInput;
    showLinkInputRef.current = showLinkInput;
    selectedIdsRef.current = selectedIds;
    selectedTemplateRef.current = selectedTemplate;
    isUploadingRef.current = isUploading;
  }, [inputValue, showRenameInput, showLinkInput, selectedIds, selectedTemplate, isUploading]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (equipmentRef.current && !equipmentRef.current.contains(e.target as Node)) {
        setShowEquipmentDropdown(false);
      }
      // Position modal handles its own closing via backdrop click
      // Save rename value before closing - only clear inputValue if this input was actually open
      if (renameRef.current && !renameRef.current.contains(e.target as Node)) {
        if (showRenameInputRef.current) {
          if (selectedTemplateRef.current && inputValueRef.current.trim()) {
            onUpdateTemplate(selectedTemplateRef.current.id, { exerciseName: inputValueRef.current.trim() });
          }
          setShowRenameInput(false);
          setInputValue('');
        }
      }
      // Close link popup on click-outside without saving — user must click Save & Process
      if (linkRef.current && !linkRef.current.contains(e.target as Node)) {
        if (showLinkInputRef.current && !isUploadingRef.current) {
          setShowLinkInput(false);
          setInputValue('');
          setLinkStart('');
          setLinkEnd('');
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onUpdateTemplate]);

  const hasSelection = selectedIds.size > 0;

  // Action handlers
  const handleEquipmentChange = (equipment: string) => {
    if (onBulkEquipmentChange) {
      onBulkEquipmentChange(Array.from(selectedIds), equipment);
    } else {
      selectedIds.forEach(id => {
        onUpdateTemplate(id, { equipmentType: equipment });
      });
    }
    setShowEquipmentDropdown(false);
  };

  const handlePositionChange = (positionId: string, positionName: string) => {
    if (onBulkPositionChange) {
      onBulkPositionChange(Array.from(selectedIds), positionId, positionName);
    } else {
      selectedIds.forEach(id => {
        onUpdateTemplate(id, { positionId, positionName });
      });
    }
    setShowPositionDropdown(false);
  };

  const handleRename = () => {
    if (selectedTemplate && inputValue.trim()) {
      onUpdateTemplate(selectedTemplate.id, { exerciseName: inputValue.trim() });
    }
    setShowRenameInput(false);
    setInputValue('');
  };

  const handleLinkSaveAndProcess = async () => {
    if (!selectedTemplate || isUploading) return;
    const template = selectedTemplate;
    const url = inputValue.trim();
    const start = linkStart.trim() ? parseFloat(linkStart) : undefined;
    const end = linkEnd.trim() ? parseFloat(linkEnd) : undefined;

    // Build time updates
    const timeUpdates: Partial<ExerciseTemplate> = {};
    if (start !== undefined && !isNaN(start)) timeUpdates.startTime = start;
    else if (linkStart.trim() === '') timeUpdates.startTime = undefined;
    if (end !== undefined && !isNaN(end)) timeUpdates.endTime = end;
    else if (linkEnd.trim() === '') timeUpdates.endTime = undefined;

    // No URL → just save times
    if (!url) {
      await onUpdateTemplate(template.id, timeUpdates);
      setShowLinkInput(false);
      setInputValue('');
      return;
    }

    // If URL is already the saved inputVideoUrl (video already downloaded), just save times
    if (template.inputVideoUrl && url === template.inputVideoUrl) {
      await onUpdateTemplate(template.id, timeUpdates);
      setShowLinkInput(false);
      setInputValue('');
      setUploadedDirectUrl(null);
      return;
    }

    // Determine if this is a direct file URL (just uploaded) or an external URL needing download
    const isDirectUpload = uploadedDirectUrl && url === uploadedDirectUrl;

    setIsUploading(true);
    setProcessingTemplateId(template.id);
    try {
      let videoUrl: string;

      if (isDirectUpload) {
        // File was already uploaded to storage — use directly
        videoUrl = url;
      } else {
        // External URL — download via proxy
        setUploadProcessing('downloading');
        videoUrl = await downloadVideo(url);
      }

      const updates: Partial<ExerciseTemplate> = {
        ...timeUpdates,
        inputVideoUrl: videoUrl,
        youtubeUrl: undefined,
      };

      // Trim if start/end are set
      const trimStart = timeUpdates.startTime ?? template.startTime;
      const trimEnd = timeUpdates.endTime ?? template.endTime;
      if (trimStart !== undefined && trimEnd !== undefined && trimStart < trimEnd) {
        setUploadProcessing('trimming');
        const trimmedBlob = await trimVideo(videoUrl, trimStart, trimEnd);
        const trimmedUrl = await uploadTrimmedVideo(trimmedBlob);
        videoUrl = trimmedUrl;
        updates.inputVideoUrl = trimmedUrl;
        updates.isTrimmed = true;
      }

      console.log('[LinkSave] Saving template update:', { id: template.id, inputVideoUrl: updates.inputVideoUrl, isTrimmed: updates.isTrimmed });
      await onUpdateTemplate(template.id, updates);
      console.log('[LinkSave] Template saved successfully');

      setShowLinkInput(false);
      setInputValue('');
      setUploadedDirectUrl(null);
    } catch (error) {
      console.error('Download/process failed:', error);
      const errMsg = error instanceof Error ? error.message : 'Download failed';
      try {
        if (isDirectUpload) {
          // Direct upload succeeded but trim failed — save the uploaded URL without trimming
          await onUpdateTemplate(template.id, { ...timeUpdates, inputVideoUrl: url, youtubeUrl: undefined });
          console.log('Saved uploaded (untrimmed) video URL after trim failure');
        } else {
          // External URL download failed — save as youtubeUrl for manual download later
          await onUpdateTemplate(template.id, { ...timeUpdates, youtubeUrl: url, inputVideoUrl: undefined, isTrimmed: false });
        }
      } catch (saveErr) {
        console.error('Failed to save fallback URL:', saveErr);
      }
      setDownloadError(errMsg);
      setTimeout(() => setDownloadError(null), 8000);
      setShowLinkInput(false);
      setInputValue('');
      setUploadedDirectUrl(null);
    } finally {
      setIsUploading(false);
      setUploadProcessing(null);
      setProcessingTemplateId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTemplate || !e.target.files?.[0]) return;
    const file = e.target.files[0];

    setIsUploading(true);
    try {
      // Upload file to Supabase Storage
      const path = `uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage
        .from('videos')
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(path);

      // Stage the URL in the input — user can now set start/end times and click Save & Process
      setInputValue(urlData.publicUrl);
      setUploadedDirectUrl(urlData.publicUrl);
    } catch (error) {
      console.error('File upload failed:', error);
      alert('Failed to upload file. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = () => {
    if (!confirm(`Delete ${selectedIds.size} template${selectedIds.size > 1 ? 's' : ''}?`)) return;
    if (onBulkDelete) {
      onBulkDelete(Array.from(selectedIds));
    } else {
      selectedIds.forEach(id => onDeleteTemplate(id));
    }
    onSelectionChange(new Set());
  };

  const handleDuplicate = () => {
    if (selectedTemplate) {
      onDuplicateTemplate(selectedTemplate);
    }
  };

  return (
    <div>
      {/* Action bar - sticky at top of viewport */}
      <div className="sticky top-0 z-30 flex items-center gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-t-xl shadow-sm select-none overflow-visible">
        {hasSelection ? (
          <>
            <button
              onClick={() => {
                onSelectionChange(new Set());
                setLastSelectedIndex(null);
              }}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
              title="Clear selection (Esc)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <span className="text-sm font-medium text-gray-700">
              {selectedIds.size} selected
            </span>
            <div className="flex-1" />

            {/* Rename - single item only */}
            {selectedIds.size === 1 && (
              <div ref={renameRef} className="relative">
                <button
                  onClick={() => {
                    if (showRenameInput) return; // Don't toggle if already open
                    const val = selectedTemplate?.exerciseName || '';
                    setInputValue(val);
                    setOriginalValue(val);
                    setShowRenameInput(true);
                    setShowEquipmentDropdown(false);
                    setShowPositionDropdown(false);
                    setShowLinkInput(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Rename
                </button>
                {showRenameInput && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder="Exercise name"
                      autoFocus
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleRename();
                        }
                        if (e.key === 'Escape') {
                          setInputValue(originalValue);
                          setShowRenameInput(false);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Equipment dropdown - hover to show */}
            <div
              ref={equipmentRef}
              className="relative"
              onMouseEnter={() => setShowEquipmentDropdown(true)}
              onMouseLeave={() => setShowEquipmentDropdown(false)}
            >
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Equipment
              </button>
              {showEquipmentDropdown && (
                <div className="absolute top-full left-0 mt-0 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {equipmentOptions.map((eq) => (
                    <button
                      key={eq.value}
                      onClick={() => handleEquipmentChange(eq.value)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {eq.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Position button - click to open modal */}
            <div ref={positionRef}>
              <button
                onClick={() => {
                  const defaultEquip = selectedIds.size === 1 && selectedTemplate?.equipmentType
                    ? selectedTemplate.equipmentType
                    : 'All';
                  setPositionEquipFilter(defaultEquip);
                  setShowPositionDropdown(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Position
              </button>
            </div>

            <PositionPickerModal
              isOpen={showPositionDropdown}
              onClose={() => setShowPositionDropdown(false)}
              positions={positions}
              equipmentOptions={equipmentOptionsProp}
              selectedTemplate={selectedTemplate || null}
              onPositionSelect={handlePositionChange}
              onRemovePosition={selectedTemplate ? () => {
                onUpdateTemplate(selectedTemplate.id, { positionId: undefined, positionName: undefined });
                setShowPositionDropdown(false);
              } : undefined}
              onCreatePosition={onCreatePosition}
              defaultEquipFilter={positionEquipFilter}
            />

            {/* Link - single item only */}
            {selectedIds.size === 1 && (
              <div ref={linkRef} className="relative">
                <button
                  onClick={() => {
                    if (showLinkInput) return; // Don't toggle if already open
                    console.log('[LinkOpen] selectedTemplate.inputVideoUrl:', selectedTemplate?.inputVideoUrl);
                    const val = selectedTemplate?.youtubeUrl || selectedTemplate?.inputVideoUrl || '';
                    setInputValue(val);
                    setOriginalValue(val);
                    setLinkStart(selectedTemplate?.startTime?.toString() || '');
                    setLinkEnd(selectedTemplate?.endTime?.toString() || '');
                    setLinkViewMode(!!selectedTemplate?.inputVideoUrl);
                    setUploadedDirectUrl(null);
                    setShowLinkInput(true);
                    setShowEquipmentDropdown(false);
                    setShowPositionDropdown(false);
                    setShowRenameInput(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Link
                </button>
                {showLinkInput && (
                  <div className="absolute top-full right-0 mt-1 w-96 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4">
                    {linkViewMode ? (
                      /* "Video ready" summary view */
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-green-100">
                            <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-green-700">Video ready</p>
                            <p className="text-xs text-gray-500 truncate max-w-[280px]" title={selectedTemplate?.inputVideoUrl || ''}>
                              {selectedTemplate?.isTrimmed ? 'Downloaded & trimmed' : 'Downloaded'}
                            </p>
                          </div>
                        </div>
                        {/* Video preview player */}
                        {selectedTemplate?.inputVideoUrl && (
                          <div className="mb-3 rounded-lg overflow-hidden bg-black">
                            <video
                              key={selectedTemplate.inputVideoUrl}
                              src={selectedTemplate.inputVideoUrl}
                              controls
                              className="w-full max-h-48 object-contain"
                              preload="metadata"
                            />
                          </div>
                        )}
                        {(selectedTemplate?.startTime !== undefined || selectedTemplate?.endTime !== undefined) && (
                          <div className="flex gap-4 mb-3 px-2 py-1.5 bg-gray-50 rounded text-xs text-gray-600">
                            <span>Start: <strong>{selectedTemplate?.startTime ?? '—'}</strong>s</span>
                            <span>End: <strong>{selectedTemplate?.endTime ?? '—'}</strong>s</span>
                          </div>
                        )}
                        {selectedTemplate?.rerunNote && (
                          <div className="mb-3 px-2 py-1.5 bg-gray-50 rounded text-xs text-gray-600">
                            Note: {selectedTemplate.rerunNote}
                          </div>
                        )}
                        <button
                          onClick={() => setLinkViewMode(false)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Change
                        </button>
                      </div>
                    ) : (
                      /* Edit form */
                      <>
                        {/* Row 1: Video source — URL or File side by side */}
                        <div className="flex gap-2">
                          <div className="flex-1 min-w-0">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Video URL</label>
                            <input
                              type="text"
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              placeholder="Paste link..."
                              autoFocus
                              disabled={isUploading}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape' && !isUploading) {
                                  setShowLinkInput(false);
                                  setInputValue('');
                                }
                              }}
                            />
                          </div>
                          <div className="flex flex-col">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Or File</label>
                            <label className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border rounded cursor-pointer transition-colors whitespace-nowrap ${isUploading ? 'bg-gray-100 text-gray-400 border-gray-300 border-dashed' : uploadedDirectUrl ? 'bg-green-50 text-green-700 border-green-300' : 'text-gray-600 hover:bg-gray-50 hover:border-gray-400 border-dashed border-gray-300'}`}>
                              {isUploading && !uploadProcessing ? (
                                <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Uploading</>
                              ) : uploadedDirectUrl ? (
                                <>
                                  <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                  Uploaded
                                </>
                              ) : (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                  </svg>
                                  Upload
                                </>
                              )}
                              <input type="file" accept="video/*" onChange={handleFileUpload} disabled={isUploading} className="hidden" />
                            </label>
                          </div>
                        </div>
                        {/* Row 2: Start / End times side by side */}
                        <div className="flex gap-2 mt-3">
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Start (sec)</label>
                            <input
                              type="text"
                              value={linkStart}
                              onChange={(e) => setLinkStart(e.target.value)}
                              placeholder="0"
                              disabled={isUploading}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">End (sec)</label>
                            <input
                              type="text"
                              value={linkEnd}
                              onChange={(e) => setLinkEnd(e.target.value)}
                              placeholder="7"
                              disabled={isUploading}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                            />
                          </div>
                        </div>
                        {/* External download helper — show when URL is unchanged (failed import link) */}
                        {(() => {
                          const urlUnchanged = inputValue.trim() === originalValue.trim() && inputValue.trim() !== '';
                          const hasNewSource = uploadedDirectUrl || inputValue.trim() !== originalValue.trim();
                          const isYouTube = inputValue.includes('youtube.com') || inputValue.includes('youtu.be');

                          if (urlUnchanged && !uploadedDirectUrl && !isUploading) {
                            return (
                              <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                                <p className="text-xs text-orange-800 mb-2">
                                  This link couldn&apos;t be auto-downloaded. Open it in your browser, download the video, then upload it above.
                                </p>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(inputValue.trim());
                                    if (isYouTube) {
                                      window.open('https://v6.www-y2mate.com/', '_blank');
                                    } else {
                                      window.open(inputValue.trim(), '_blank');
                                    }
                                  }}
                                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-orange-700 bg-white border border-orange-300 rounded-lg hover:bg-orange-100 transition-colors"
                                >
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  {isYouTube ? 'Open in y2mate (link copied)' : 'Open link in browser (copied)'}
                                </button>
                                <label className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                  </svg>
                                  Upload Video
                                  <input type="file" accept="video/*" onChange={handleFileUpload} className="hidden" />
                                </label>
                              </div>
                            );
                          }
                          return null;
                        })()}
                        {/* Row 3: Save & Process — only enabled when URL changed or file uploaded */}
                        <button
                          onClick={handleLinkSaveAndProcess}
                          disabled={isUploading || (!uploadedDirectUrl && inputValue.trim() === originalValue.trim()) || !inputValue.trim()}
                          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
                        >
                          {uploadProcessing === 'downloading' ? (
                            <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Downloading...</>
                          ) : uploadProcessing === 'trimming' ? (
                            <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Trimming...</>
                          ) : uploadProcessing === 'generating' ? (
                            <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Generating position...</>
                          ) : isUploading ? (
                            <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Processing...</>
                          ) : (
                            'Save & Process'
                          )}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Duplicate - single item only */}
            {selectedIds.size === 1 && (
              <button
                onClick={handleDuplicate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Duplicate
              </button>
            )}

            {/* Delete */}
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>

            {/* Output - Primary action */}
            {onBatchOutput && (
              <button
                onClick={onBatchOutput}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Output ({selectedIds.size}) →
              </button>
            )}
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-gray-700">
              Pending ({templates.length})
            </span>
            <div className="flex-1" />
            {(() => {
              const pendingUrls = templates.filter(t => !t.inputVideoUrl && t.youtubeUrl).map(t => t.youtubeUrl!);
              return pendingUrls.length > 0 ? (
                <button
                  onClick={() => { for (const url of pendingUrls) window.open(url, '_blank'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open Pending ({pendingUrls.length})
                </button>
              ) : null;
            })()}
            {onBatchAssignPositions && (
              <button
                onClick={onBatchAssignPositions}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h8m-8 4h4" />
                </svg>
                Batch Assign Positions
              </button>
            )}
            <button
              onClick={onAddNewTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add New
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <div
        ref={tableRef}
        className="overflow-x-auto rounded-b-xl border-x border-b border-gray-200 shadow-sm focus:outline-none select-none bg-gray-50"
        tabIndex={0}
      >
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th
                onClick={() => onSort('link')}
                className="w-[50px] px-2 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  Link
                  {sortColumn === 'link' && (
                    <span className="text-blue-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => onSort('position')}
                className="w-[50px] px-2 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  Pos
                  {sortColumn === 'position' && (
                    <span className="text-blue-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => onSort('name')}
                className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  Name
                  {sortColumn === 'name' && (
                    <span className="text-blue-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th
                onClick={() => onSort('equipment')}
                className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  Equipment
                  {sortColumn === 'equipment' && (
                    <span className="text-blue-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t, rowIdx) => {
              const isRowSelected = selectedIds.has(t.id);
              return (
                <tr
                  key={`${t.id}-${rowIdx}`}
                  onClick={(e) => handleRowClick(e, rowIdx, t.id)}
                  className={`group cursor-pointer transition-colors ${
                    isRowSelected
                      ? 'bg-blue-100'
                      : t.hadIssue
                        ? 'bg-red-50 hover:bg-red-100'
                        : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {/* Link indicator */}
                  <td className="px-2 py-2 text-center">
                    {processingTemplateId === t.id && uploadProcessing ? (
                      <svg className="animate-spin h-3.5 w-3.5 mx-auto text-blue-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <span title={t.inputVideoUrl ? 'Video ready' : t.youtubeUrl ? 'YouTube URL (not downloaded)' : 'No link'}>
                        <svg
                          className={`h-3.5 w-3.5 mx-auto ${t.inputVideoUrl ? 'text-green-500' : 'text-gray-300'}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      </span>
                    )}
                  </td>

                  {/* Position indicator */}
                  <td className="px-2 py-2 text-center">
                    <span title={t.positionName ? `Position: ${t.positionName}` : 'No position'}>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className={`h-3.5 w-3.5 mx-auto ${t.positionName ? 'text-green-500' : 'text-gray-300'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </span>
                  </td>

                  {/* Name + status icons */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {t.hadIssue && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setErrorModal({ name: t.exerciseName || 'Exercise', message: t.errorMessage || 'Had issue - check and retry' }); }}
                          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-red-100 hover:bg-red-200 transition-colors"
                          title="View error"
                        >
                          <span className="text-[10px] font-bold text-red-600">!</span>
                        </button>
                      )}
                      {t.isRerun && (
                        <svg className="h-3.5 w-3.5 flex-shrink-0 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      <span className="text-sm text-gray-900 truncate">{t.exerciseName || '—'}</span>
                    </div>
                  </td>

                  {/* Equipment */}
                  <td className="px-2 py-2 whitespace-nowrap">
                    {t.equipmentType ? (
                      <Badge variant="equipment" value={t.equipmentType} />
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {downloadError && (
        <div className="mt-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-medium flex items-center gap-2">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Process failed: {downloadError}
        </div>
      )}

      {/* Error detail modal */}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setErrorModal(null)}>
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                <span className="text-sm font-bold text-red-600">!</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{errorModal.name}</p>
                <p className="text-xs text-gray-500">Error Details</p>
              </div>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-800 whitespace-pre-wrap break-words">{errorModal.message}</p>
            </div>
            <button
              onClick={() => setErrorModal(null)}
              className="mt-4 w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
