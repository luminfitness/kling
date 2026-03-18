import { NextRequest, NextResponse } from 'next/server';
import { createMotionControlTask } from '@/lib/kling';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      imageUrl,
      videoUrl,
      characterOrientation = 'video',
      mode = 'std',
      keepOriginalSound = 'yes',
      prompt,
    } = body;

    if (!imageUrl || !videoUrl) {
      return NextResponse.json(
        { error: 'imageUrl and videoUrl are required' },
        { status: 400 }
      );
    }

    const result = await createMotionControlTask({
      imageUrl,
      videoUrl,
      characterOrientation,
      mode,
      keepOriginalSound,
      prompt,
    });

    return NextResponse.json({
      taskId: result.taskId,
      status: result.status,
    });
  } catch (error) {
    console.error('Process error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to create task';
    // Include more detail in response for debugging
    return NextResponse.json({
      error: message,
      detail: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
