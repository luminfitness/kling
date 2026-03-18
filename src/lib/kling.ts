import jwt from 'jsonwebtoken';

const KLING_BASE_URL = 'https://api-singapore.klingai.com';

export function generateKlingJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: process.env.KLING_ACCESS_KEY!.trim(),
      exp: now + 1800,
      nbf: now - 5,
    },
    process.env.KLING_SECRET_KEY!.trim(),
    {
      header: { alg: 'HS256', typ: 'JWT' },
    }
  );
}

function getAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${generateKlingJWT()}`,
    'Content-Type': 'application/json',
  };
}

export async function createMotionControlTask(params: {
  imageUrl: string;
  videoUrl: string;
  characterOrientation: 'image' | 'video';
  mode: 'std' | 'pro';
  keepOriginalSound?: 'yes' | 'no';
  prompt?: string;
}): Promise<{ taskId: string; status: string }> {
  const body: Record<string, string> = {
    image_url: params.imageUrl,
    video_url: params.videoUrl,
    character_orientation: params.characterOrientation,
    mode: params.mode,
    keep_original_sound: params.keepOriginalSound ?? 'yes',
  };

  if (params.prompt) {
    body.prompt = params.prompt;
  }

  const response = await fetch(`${KLING_BASE_URL}/v1/videos/motion-control`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kling API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (result.code !== 0) {
    throw new Error(`Kling API error: ${result.code} - ${result.message}`);
  }

  return {
    taskId: result.data.task_id,
    status: result.data.task_status,
  };
}

export async function queryTaskStatus(taskId: string): Promise<{
  taskId: string;
  status: string;
  statusMessage: string;
  videos: Array<{ id: string; url: string; duration: string }>;
}> {
  const response = await fetch(
    `${KLING_BASE_URL}/v1/videos/motion-control/${taskId}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kling API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (result.code !== 0) {
    throw new Error(`Kling API error: ${result.code} - ${result.message}`);
  }

  const data = result.data;

  return {
    taskId: data.task_id,
    status: data.task_status,
    statusMessage: data.task_status_msg || '',
    videos: data.task_result?.videos || [],
  };
}
