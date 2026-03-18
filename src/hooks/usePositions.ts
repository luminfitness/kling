'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Position } from '@/types';

export function usePositions() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPositions = useCallback(async () => {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load positions:', error);
      setLoading(false);
      return;
    }

    const mapped: Position[] = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      equipmentType: row.equipment_type || '',
      storagePath: row.storage_path,
      publicUrl: row.public_url,
      mimeType: row.mime_type,
      createdAt: row.created_at,
    }));

    setPositions(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const createPosition = useCallback(
    async (name: string, equipmentType: string, imageFile: File): Promise<Position> => {
      const id = crypto.randomUUID();
      const ext = imageFile.type === 'image/png' ? 'png' : 'jpg';
      const storagePath = `positions/${id}.${ext}`;

      // Upload image to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('position-images')
        .upload(storagePath, imageFile, { upsert: true });

      if (uploadError) {
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('position-images')
        .getPublicUrl(storagePath);

      // Insert record
      const { error: insertError } = await supabase.from('positions').insert({
        id,
        name: name.trim(),
        equipment_type: equipmentType,
        storage_path: storagePath,
        public_url: urlData.publicUrl,
        mime_type: imageFile.type,
      });

      if (insertError) {
        // Cleanup uploaded file
        await supabase.storage.from('position-images').remove([storagePath]);
        throw new Error(`Failed to save position: ${insertError.message}`);
      }

      const newPosition: Position = {
        id,
        name: name.trim(),
        equipmentType,
        storagePath,
        publicUrl: urlData.publicUrl,
        mimeType: imageFile.type,
        createdAt: new Date().toISOString(),
      };

      await loadPositions();
      return newPosition;
    },
    [loadPositions]
  );

  const updatePosition = useCallback(
    async (id: string, name: string, equipmentType: string, imageFile?: File): Promise<void> => {
      console.log('[updatePosition] Starting update for id:', id, { name, equipmentType, hasImage: !!imageFile });

      const updates: Record<string, unknown> = { name: name.trim(), equipment_type: equipmentType };

      if (imageFile) {
        // Get existing record for cleanup
        const { data: existing, error: selectError } = await supabase
          .from('positions')
          .select('storage_path')
          .eq('id', id)
          .single();

        if (selectError) {
          console.error('[updatePosition] Failed to find position:', selectError);
          throw new Error(`Position not found: ${selectError.message}`);
        }

        // Upload new image
        const ext = imageFile.type === 'image/png' ? 'png' : 'jpg';
        const storagePath = `positions/${id}.${ext}`;

        console.log('[updatePosition] Uploading new image to:', storagePath);

        const { error: uploadError } = await supabase.storage
          .from('position-images')
          .upload(storagePath, imageFile, { upsert: true });

        if (uploadError) {
          console.error('[updatePosition] Upload error:', uploadError);
          throw new Error(`Failed to upload image: ${uploadError.message}`);
        }

        // Delete old file if different path
        if (existing?.storage_path && existing.storage_path !== storagePath) {
          await supabase.storage.from('position-images').remove([existing.storage_path]);
        }

        const { data: urlData } = supabase.storage
          .from('position-images')
          .getPublicUrl(storagePath);

        // Add cache-busting parameter to force browser to fetch new image
        const cacheBustUrl = `${urlData.publicUrl}?v=${Date.now()}`;

        updates.storage_path = storagePath;
        updates.public_url = cacheBustUrl;
        updates.mime_type = imageFile.type;
      }

      console.log('[updatePosition] Applying updates:', updates);

      const { data: updatedRows, error } = await supabase
        .from('positions')
        .update(updates)
        .eq('id', id)
        .select();

      if (error) {
        console.error('[updatePosition] Update error:', error);
        throw new Error(`Failed to update position: ${error.message}`);
      }

      // Check if any rows were actually updated
      if (!updatedRows || updatedRows.length === 0) {
        console.error('[updatePosition] No rows updated - check RLS policies');
        throw new Error('Position could not be updated. Check database permissions.');
      }

      console.log('[updatePosition] Successfully updated:', updatedRows[0]);

      await loadPositions();
      console.log('[updatePosition] Complete');
    },
    [loadPositions]
  );

  const deletePosition = useCallback(
    async (id: string): Promise<void> => {
      console.log('[deletePosition] Starting delete for id:', id);

      // Check if any templates are using this position
      const { data: usingTemplates, error: templateCheckError } = await supabase
        .from('exercise_templates')
        .select('id, exercise_name')
        .eq('position_id', id)
        .limit(5);

      if (templateCheckError) {
        console.error('[deletePosition] Template check error:', templateCheckError);
      }

      if (usingTemplates && usingTemplates.length > 0) {
        const names = usingTemplates.map(t => t.exercise_name).join(', ');
        const moreText = usingTemplates.length === 5 ? ' and possibly more' : '';
        throw new Error(`Cannot delete: This position is used by ${usingTemplates.length} template(s): ${names}${moreText}. Reassign or delete those templates first.`);
      }

      // Get storage path for cleanup
      const { data: position, error: selectError } = await supabase
        .from('positions')
        .select('storage_path')
        .eq('id', id)
        .single();

      if (selectError) {
        console.error('[deletePosition] Failed to find position:', selectError);
        throw new Error(`Position not found: ${selectError.message}`);
      }

      console.log('[deletePosition] Found position with storage_path:', position?.storage_path);

      // Delete from database first (then cleanup storage)
      const { data: deletedRows, error: deleteError } = await supabase
        .from('positions')
        .delete()
        .eq('id', id)
        .select();

      if (deleteError) {
        console.error('[deletePosition] Database delete error:', deleteError);
        // Provide friendlier message for foreign key errors
        if (deleteError.message.includes('foreign key constraint')) {
          throw new Error('Cannot delete: This position is still being used by templates or exercises.');
        }
        throw new Error(`Failed to delete position: ${deleteError.message}`);
      }

      // Check if any rows were actually deleted
      if (!deletedRows || deletedRows.length === 0) {
        console.error('[deletePosition] No rows deleted - check RLS policies');
        throw new Error('Position could not be deleted. Check database permissions.');
      }

      console.log('[deletePosition] Successfully deleted from database');

      // Cleanup storage (don't fail if storage cleanup fails)
      if (position?.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('position-images')
          .remove([position.storage_path]);
        if (storageError) {
          console.warn('[deletePosition] Storage cleanup failed:', storageError);
        }
      }

      await loadPositions();
      console.log('[deletePosition] Complete');
    },
    [loadPositions]
  );

  // Simple getter - returns the public URL directly (no equipment lookup!)
  const getPositionImageUrl = useCallback(
    (positionId: string): string | undefined => {
      const position = positions.find((p) => p.id === positionId);
      return position?.publicUrl;
    },
    [positions]
  );

  return {
    positions,
    loading,
    createPosition,
    updatePosition,
    deletePosition,
    getPositionImageUrl,
  };
}
