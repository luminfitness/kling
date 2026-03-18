'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Equipment } from '@/types';
import { DEFAULT_EQUIPMENT, equipmentNameToKey } from '@/types';

export function useEquipment() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const seededRef = useRef(false);

  const loadEquipment = useCallback(async () => {
    const { data, error } = await supabase
      .from('custom_equipment')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to load equipment:', error);
      setLoading(false);
      return;
    }

    const loadedEquipment = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      key: row.key,
      createdAt: row.created_at,
    }));

    // Seed default equipment if database is empty (only once)
    if (loadedEquipment.length === 0 && !seededRef.current) {
      seededRef.current = true;
      const seeded = await seedDefaultEquipment();
      setEquipment(seeded);
    } else {
      setEquipment(loadedEquipment);
    }

    setLoading(false);
  }, []);

  const seedDefaultEquipment = async (): Promise<Equipment[]> => {
    const now = new Date().toISOString();
    const toInsert = DEFAULT_EQUIPMENT.map((name) => ({
      id: crypto.randomUUID(),
      name,
      key: equipmentNameToKey(name),
      created_at: now,
    }));

    const { error } = await supabase.from('custom_equipment').insert(toInsert);

    if (error) {
      console.error('Failed to seed default equipment:', error);
      return [];
    }

    return toInsert.map((row) => ({
      id: row.id,
      name: row.name,
      key: row.key,
      createdAt: row.created_at,
    }));
  };

  useEffect(() => {
    loadEquipment();
  }, [loadEquipment]);

  const addEquipment = useCallback(
    async (name: string): Promise<Equipment | null> => {
      const trimmedName = name.trim();
      if (!trimmedName) return null;

      // Check if already exists
      const key = equipmentNameToKey(trimmedName);
      const exists = equipment.some((e) => e.key === key);

      if (exists) {
        console.error('Equipment with this name already exists');
        return null;
      }

      const id = crypto.randomUUID();
      const { error } = await supabase.from('custom_equipment').insert({
        id,
        name: trimmedName,
        key,
      });

      if (error) {
        console.error('Failed to add equipment:', error);
        return null;
      }

      const newEquipment: Equipment = {
        id,
        name: trimmedName,
        key,
        createdAt: new Date().toISOString(),
      };

      setEquipment((prev) => [...prev, newEquipment]);
      return newEquipment;
    },
    [equipment]
  );

  const updateEquipment = useCallback(
    async (id: string, newName: string): Promise<boolean> => {
      const trimmedName = newName.trim();
      if (!trimmedName) return false;

      // Check if new name conflicts with existing equipment (excluding self)
      const newKey = equipmentNameToKey(trimmedName);
      const exists = equipment.some((e) => e.key === newKey && e.id !== id);

      if (exists) {
        console.error('Equipment with this name already exists');
        return false;
      }

      const { error } = await supabase
        .from('custom_equipment')
        .update({ name: trimmedName, key: newKey })
        .eq('id', id);

      if (error) {
        console.error('Failed to update equipment:', error);
        return false;
      }

      setEquipment((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, name: trimmedName, key: newKey } : e
        )
      );
      return true;
    },
    [equipment]
  );

  const deleteEquipment = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('custom_equipment')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete equipment:', error);
      return;
    }

    setEquipment((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // List of all equipment names for dropdowns
  const allEquipmentNames = equipment.map((e) => e.name);

  // Map from equipment name to storage key
  const equipmentKeyMap: Record<string, string> = {};
  equipment.forEach((e) => {
    equipmentKeyMap[e.name] = e.key;
  });

  // Map from storage key to display name
  const keyToNameMap: Record<string, string> = {};
  equipment.forEach((e) => {
    keyToNameMap[e.key] = e.name;
  });

  return {
    equipment,
    loading,
    addEquipment,
    updateEquipment,
    deleteEquipment,
    allEquipmentNames,
    equipmentKeyMap,
    keyToNameMap,
  };
}
