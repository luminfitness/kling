import { supabase } from './supabase';

/**
 * Upload a file to Supabase Storage and return its public URL.
 */
export async function uploadToStorage(
  bucket: string,
  path: string,
  data: File | ArrayBuffer | Blob,
  contentType: string
): Promise<string> {
  // Convert ArrayBuffer to Blob for Supabase client
  const body = data instanceof ArrayBuffer ? new Blob([data], { type: contentType }) : data;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType, upsert: true });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Delete files from Supabase Storage.
 */
export async function deleteFromStorage(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}

/**
 * Get the public URL for a file in Supabase Storage.
 */
export function getStoragePublicUrl(bucket: string, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
