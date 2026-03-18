import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-image-preview';

// Default background color (bright green)
const DEFAULT_BACKGROUND = '#1be300';

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const { images, prompt, outputCount = 1, aspectRatio = '9:16' } = await request.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: 'At least one image is required' },
        { status: 400 }
      );
    }

    if (images.length > 3) {
      return NextResponse.json(
        { error: 'Maximum 3 images allowed' },
        { status: 400 }
      );
    }

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Initialize the SDK
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Prepare content parts
    const contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Add prompt with background color instruction
    const finalPrompt = `${prompt.trim()}\n\nIMPORTANT: The background MUST be a perfectly flat, solid ${DEFAULT_BACKGROUND} (bright green) color with absolutely no drop shadows, cast shadows, ambient occlusion, gradients, or any shading of any kind on the background. The background should be a single uniform color.`;
    contentParts.push({ text: finalPrompt });

    // Process each image
    for (const image of images) {
      if (image.startsWith('data:')) {
        const matches = image.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          contentParts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2],
            },
          });
        }
      } else {
        // URL - fetch and convert to base64
        const imgData = await fetchImageAsBase64(image);
        contentParts.push({
          inlineData: {
            mimeType: imgData.mimeType,
            data: imgData.data,
          },
        });
      }
    }

    // Generate requested number of images (call API for each)
    const numImages = Math.min(Math.max(outputCount, 1), 4);
    const generatedImages: string[] = [];
    const errors: string[] = [];

    console.log(`[image-gen] Generating ${numImages} image(s)...`);

    for (let i = 0; i < numImages; i++) {
      try {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: contentParts,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: aspectRatio,
            },
          },
        });

        // Extract image from response
        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData?.mimeType?.startsWith('image/')) {
              const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
              generatedImages.push(imageUrl);
              break; // Only take first image per response
            }
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || err?.statusText || String(err);
        const errStatus = err?.status || err?.code || '';
        const fullMsg = errStatus ? `[${errStatus}] ${errMsg}` : errMsg;
        console.error(`[image-gen] Failed to generate image ${i + 1}:`, fullMsg);
        errors.push(`Image ${i + 1}: ${fullMsg}`);
      }
    }

    if (generatedImages.length === 0) {
      return NextResponse.json(
        { error: errors.length > 0 ? errors.join('; ') : 'No images were generated. Try adjusting your prompt.' },
        { status: 500 }
      );
    }

    console.log(`[image-gen] Generated ${generatedImages.length} image(s)`);
    return NextResponse.json({ images: generatedImages });

  } catch (error: any) {
    const errMsg = error?.message || error?.statusText || String(error);
    const errStatus = error?.status || error?.code || '';
    const fullMsg = errStatus ? `[${errStatus}] ${errMsg}` : errMsg;
    console.error('[image-gen] Error:', fullMsg);
    return NextResponse.json(
      { error: fullMsg },
      { status: 500 }
    );
  }
}

// Helper to fetch image from URL and convert to base64
async function fetchImageAsBase64(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return {
    mimeType: contentType,
    data: base64,
  };
}
