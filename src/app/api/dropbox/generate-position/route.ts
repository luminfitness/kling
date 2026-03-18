import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3-pro-image-preview';

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const {
      exerciseName,
      poseReference,
      characterBackground,
      equipment1,
      equipment2,
      equipment3,
      customPrompt,
    } = await request.json();

    if (!poseReference || !characterBackground) {
      return NextResponse.json(
        { error: 'Pose reference and character/background images are required' },
        { status: 400 }
      );
    }

    // Count how many equipment images we have
    const equipmentImages = [equipment1, equipment2, equipment3].filter(Boolean);
    const equipmentCount = equipmentImages.length;

    // Build the prompt based on what's provided
    let prompt = customPrompt;
    if (!prompt) {
      prompt = `Create a single photorealistic reference image for the exercise "${exerciseName}".

Instructions:
1. Take the CHARACTER from the 1st reference image (the person/avatar and their background/environment)
2. Place the character in the exact POSE shown in the 2nd reference image (the body position, stance, and orientation)`;

      if (equipmentCount > 0) {
        prompt += `
3. Include the EQUIPMENT from the additional reference images (images 3${equipmentCount > 1 ? `-${equipmentCount + 2}` : ''}), positioned naturally as the person would hold/use them for this exercise`;
      }

      prompt += `

The final image should look like a real photo showing the starting position of this exercise.
Keep the background from the character image.
The person should be holding any equipment in the correct grip/position for this exercise.
Maintain consistent lighting and perspective throughout.`;
    }

    // Initialize the SDK
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Prepare content parts
    const contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Add prompt first
    contentParts.push({ text: prompt });

    // Helper to add image to content parts
    const addImage = async (imageData: string) => {
      if (imageData.startsWith('data:')) {
        const matches = imageData.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          contentParts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2],
            },
          });
        }
      } else {
        // It's a URL, fetch and convert
        const data = await fetchImageAsBase64(imageData);
        contentParts.push({
          inlineData: {
            mimeType: data.mimeType,
            data: data.data,
          },
        });
      }
    };

    // Add images in order: character, pose, equipment1, equipment2, equipment3
    await addImage(characterBackground);
    await addImage(poseReference);

    if (equipment1) await addImage(equipment1);
    if (equipment2) await addImage(equipment2);
    if (equipment3) await addImage(equipment3);

    console.log(`[generate-position] Generating for "${exerciseName}" with ${2 + equipmentCount} images`);

    // Call Gemini
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

    // Check for image in response
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          console.log('[generate-position] Successfully generated image');
          return NextResponse.json({ imageUrl });
        }
      }
    }

    // No image found
    const textParts = response.candidates?.[0]?.content?.parts?.filter((p) => p.text);
    if (textParts && textParts.length > 0) {
      return NextResponse.json(
        { error: `No image generated. Model response: ${textParts.map((p) => p.text).join(' ')}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'No image was generated. Try different input images.' },
      { status: 500 }
    );
  } catch (error) {
    console.error('[generate-position] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate position image' },
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
