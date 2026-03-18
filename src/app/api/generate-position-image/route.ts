import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Use Nano Banana Pro for professional asset production
const MODEL = 'gemini-3.1-flash-image-preview';

const PASS2_PROMPT = "Remove any branding from the photo and make the machine's color black. Don't change anything else about the photo.";

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const { referenceImage1, referenceImage2, prompt, twoPass } = await request.json();

    if (!referenceImage1) {
      return NextResponse.json(
        { error: 'At least one reference image is required' },
        { status: 400 }
      );
    }

    // Initialize the SDK
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Build content parts for Pass 1
    const contentParts: ContentPart[] = [];

    const defaultPrompt = `Make the character in the 1st reference image be in the pose of the second photo and holding the equipment in the same way. Keep the original background of 1st reference image.`;
    contentParts.push({ text: prompt || defaultPrompt });

    // Process reference image 1
    const img1Part = await imageToInlineData(referenceImage1);
    contentParts.push(img1Part);

    // Process reference image 2 (optional)
    if (referenceImage2) {
      const img2Part = await imageToInlineData(referenceImage2);
      contentParts.push(img2Part);
    }

    // Pass 1: Generate
    console.log(`Gemini Pass 1: generating${twoPass ? ' (two-pass mode)' : ''}...`);
    const pass1Result = await callGemini(ai, contentParts);

    if (!pass1Result) {
      return NextResponse.json(
        { error: 'No image was generated in Pass 1. Try adjusting your prompt.' },
        { status: 500 }
      );
    }

    // If not two-pass, return Pass 1 result directly
    if (!twoPass) {
      const imageUrl = `data:${pass1Result.mimeType};base64,${pass1Result.data}`;
      return NextResponse.json({ imageUrl });
    }

    // Pass 2: Refine — remove branding, make equipment black (server-side, no round trip)
    console.log('Gemini Pass 2: refining (branding/color)...');
    const pass2Parts: ContentPart[] = [
      { text: PASS2_PROMPT },
      { inlineData: { mimeType: pass1Result.mimeType, data: pass1Result.data } },
    ];

    const pass2Result = await callGemini(ai, pass2Parts);

    if (!pass2Result) {
      // Fall back to Pass 1 result if Pass 2 fails
      console.warn('Pass 2 failed, returning Pass 1 result');
      const imageUrl = `data:${pass1Result.mimeType};base64,${pass1Result.data}`;
      return NextResponse.json({ imageUrl });
    }

    const imageUrl = `data:${pass2Result.mimeType};base64,${pass2Result.data}`;
    return NextResponse.json({ imageUrl });

  } catch (error) {
    console.error('Generate position image error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate image' },
      { status: 500 }
    );
  }
}

// Call Gemini and extract the image result
async function callGemini(
  ai: GoogleGenAI,
  contentParts: ContentPart[]
): Promise<{ mimeType: string; data: string } | null> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: contentParts,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: '3:4',
        imageSize: '4K',
      },
    },
  });

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        return { mimeType: part.inlineData.mimeType, data: part.inlineData.data! };
      }
    }
  }

  // Log text response if any
  const textParts = response.candidates?.[0]?.content?.parts?.filter((p) => p.text);
  if (textParts && textParts.length > 0) {
    console.warn(`Gemini returned text instead of image: ${textParts.map((p) => p.text).join(' ')}`);
  }

  return null;
}

// Convert a data URL or public URL to an inlineData content part
async function imageToInlineData(imageSource: string): Promise<ContentPart> {
  if (imageSource.startsWith('data:')) {
    const matches = imageSource.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      return { inlineData: { mimeType: matches[1], data: matches[2] } };
    }
  }

  // Fetch from URL
  const response = await fetch(imageSource);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return { inlineData: { mimeType: contentType, data: base64 } };
}
