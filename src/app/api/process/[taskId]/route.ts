import { NextRequest, NextResponse } from 'next/server';
import { queryTaskStatus } from '@/lib/kling';

export async function GET(
  _req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;

    if (!taskId) {
      return NextResponse.json(
        { error: 'taskId is required' },
        { status: 400 }
      );
    }

    const result = await queryTaskStatus(taskId);

    return NextResponse.json({
      taskId: result.taskId,
      status: result.status,
      statusMessage: result.statusMessage,
      videos: result.videos,
    });
  } catch (error) {
    console.error('Poll error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to query task status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
