import { NextRequest, NextResponse } from 'next/server';
import { uploadToStorage } from '@/lib/supabaseStorage';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null;

    if (!file || !type) {
      return NextResponse.json(
        { error: 'Missing file or type parameter' },
        { status: 400 }
      );
    }

    const isImage = type === 'image';
    const allowedTypes = isImage ? ALLOWED_IMAGE_TYPES : ALLOWED_VIDEO_TYPES;
    const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${file.type}. Allowed: ${allowedTypes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `File too large. Max size: ${maxSize / 1024 / 1024}MB`,
        },
        { status: 413 }
      );
    }

    const ext = file.name.split('.').pop() || (isImage ? 'jpg' : 'mp4');
    const filename = `${type}s/${uuidv4()}.${ext}`;

    const publicUrl = await uploadToStorage('videos', filename, file, file.type);

    return NextResponse.json({
      url: publicUrl,
      filename: filename,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'Unknown';
    console.error('Upload error:', errorName, errorMessage, error);
    return NextResponse.json(
      { error: `Upload failed: ${errorName}: ${errorMessage}` },
      { status: 500 }
    );
  }
}
