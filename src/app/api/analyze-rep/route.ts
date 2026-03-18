import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

interface AnalyzeRepRequest {
  frames: string[];         // Array of base64 data URLs
  frameInterval: number;    // Seconds between frames
  exerciseName: string;     // For context in the prompt
}

interface AnalyzeRepResponse {
  start_time: number;
  end_time: number;
  confidence: number;
  reasoning?: string;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const { frames, frameInterval, exerciseName }: AnalyzeRepRequest = await req.json();

    if (!frames || frames.length < 4) {
      return NextResponse.json(
        { error: 'At least 4 frames required for analysis' },
        { status: 400 }
      );
    }

    const openai = new OpenAI({ apiKey });

    // Build the content array with text prompt and all frames
    const imageContent: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = frames.map((frame) => ({
      type: 'image_url' as const,
      image_url: {
        url: frame,  // OpenAI accepts data URLs directly
        detail: 'low' as const,  // Use low detail to reduce cost/tokens
      },
    }));

    const textPrompt = `You are analyzing frames from an exercise video called "${exerciseName}".
Frames are captured every ${frameInterval} seconds.
Frame 0 = 0 seconds, Frame 1 = ${frameInterval} seconds, Frame 2 = ${frameInterval * 2} seconds, etc.
Total frames: ${frames.length} (covering ${(frames.length * frameInterval).toFixed(1)} seconds)

TASK: Identify ONE complete repetition where:
1. The start pose and end pose are approximately the same position (for smooth video looping)
2. The repetition shows the full range of motion of the exercise
3. Prefer a rep in the MIDDLE of the video (avoid the first or last rep which may be incomplete)
4. The person should be in a neutral/starting position at both start and end

IMPORTANT: The goal is to create a loopable video clip, so the start frame and end frame should show the person in nearly identical positions.

Analyze the frames and return ONLY a JSON object with:
{
  "start_time": <number - seconds when the rep starts>,
  "end_time": <number - seconds when the rep ends>,
  "confidence": <number from 0 to 1 indicating how good this clip will loop>,
  "reasoning": "<brief explanation of why you chose these timestamps>"
}

Return ONLY the JSON object, no other text.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: textPrompt },
            ...imageContent,
          ],
        },
      ],
    });

    // Extract text from response
    const textContent = response.choices[0]?.message?.content;
    if (!textContent) {
      return NextResponse.json(
        { error: 'No text response from OpenAI' },
        { status: 500 }
      );
    }

    // Parse JSON from response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[analyze-rep] Failed to parse JSON from:', textContent);
      return NextResponse.json(
        { error: 'Failed to parse response from OpenAI', raw: textContent },
        { status: 500 }
      );
    }

    const result: AnalyzeRepResponse = JSON.parse(jsonMatch[0]);

    // Validate the response
    if (
      typeof result.start_time !== 'number' ||
      typeof result.end_time !== 'number' ||
      result.start_time < 0 ||
      result.end_time <= result.start_time
    ) {
      return NextResponse.json(
        { error: 'Invalid timestamps from OpenAI', result },
        { status: 500 }
      );
    }

    console.log(`[analyze-rep] ${exerciseName}: ${result.start_time}s → ${result.end_time}s (confidence: ${result.confidence})`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[analyze-rep] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
