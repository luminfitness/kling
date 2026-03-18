'use client';

import { useState } from 'react';
import type { Equipment } from '@/types';

interface EquipmentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  equipment: Equipment[];
  onAddEquipment: (name: string) => Promise<Equipment | null>;
  onUpdateEquipment: (id: string, name: string) => Promise<boolean>;
  onDeleteEquipment: (id: string) => Promise<void>;
}

export default function EquipmentManagementModal({
  isOpen,
  onClose,
  equipment,
  onAddEquipment,
  onUpdateEquipment,
  onDeleteEquipment,
}: EquipmentManagementModalProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);

    const result = await onAddEquipment(newName.trim());
    if (result) {
      setNewName('');
    } else {
      setError('Equipment with this name already exists');
    }
    setSaving(false);
  };

  const handleStartEdit = (eq: Equipment) => {
    setEditingId(eq.id);
    setEditingName(eq.name);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    setSaving(true);
    setError(null);

    const success = await onUpdateEquipment(editingId, editingName.trim());
    if (success) {
      setEditingId(null);
      setEditingName('');
    } else {
      setError('Equipment with this name already exists');
    }
    setSaving(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
    setError(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this equipment type? This cannot be undone.')) return;
    await onDeleteEquipment(id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Manage Equipment</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Error message */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Add new equipment */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Add Equipment</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Cable Machine, Smith Machine..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
              />
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
              >
                Add
              </button>
            </div>
          </div>

          {/* Equipment list */}
          {equipment.length > 0 && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Equipment ({equipment.length})</label>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {equipment.map((eq) => (
                  <div key={eq.id} className="flex items-center justify-between px-3 py-2">
                    {editingId === eq.id ? (
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => {
                            setEditingName(e.target.value);
                            setError(null);
                          }}
                          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                        />
                        <button
                          onClick={handleSaveEdit}
                          disabled={!editingName.trim() || saving}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-gray-700">{eq.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleStartEdit(eq)}
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            title="Edit"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(eq.id)}
                            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            title="Delete"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {equipment.length === 0 && (
            <div className="text-center py-8 text-sm text-gray-400">
              No equipment yet. Add some above.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
