import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

type GeminiApiKeyEntry = {
  label: string;
  order: number;
  apiKey: string;
};

const GEMINI_NUMBERED_KEY_REGEX = /^GEMINI_API_KEY_(\d+)$/;

const dedupeKeyEntries = (entries: GeminiApiKeyEntry[]) => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.apiKey)) {
      return false;
    }
    seen.add(entry.apiKey);
    return true;
  });
};

const discoverNumberedGeminiKeys = (): GeminiApiKeyEntry[] => {
  const discovered = Object.entries(process.env)
    .map(([name, value]) => {
      const match = name.match(GEMINI_NUMBERED_KEY_REGEX);
      if (!match || !value || !value.trim()) {
        return null;
      }

      return {
        label: name,
        order: Number(match[1]),
        apiKey: value.trim(),
      } as GeminiApiKeyEntry;
    })
    .filter((entry): entry is GeminiApiKeyEntry => Boolean(entry))
    .sort((a, b) => a.order - b.order);

  return dedupeKeyEntries(discovered);
};

const LEGACY_GEMINI_KEYS: GeminiApiKeyEntry[] = [
  {
    label: 'GEMINI_API_KEY',
    order: 1,
    apiKey: process.env.GEMINI_API_KEY?.trim() || '',
  },
  {
    label: 'GEMINI_API_KEY_2',
    order: 2,
    apiKey: process.env.GEMINI_API_KEY_2?.trim() || '',
  },
].filter((entry) => Boolean(entry.apiKey));

const GEMINI_API_KEY_POOL = (() => {
  const numbered = discoverNumberedGeminiKeys();
  if (numbered.length > 0) {
    return numbered;
  }

  return dedupeKeyEntries(LEGACY_GEMINI_KEYS);
})();

const PRIMARY_GEMINI_API_KEY = GEMINI_API_KEY_POOL[0]?.apiKey;

if (!PRIMARY_GEMINI_API_KEY) {
  console.warn(
    '⚠️ No Gemini API key detected. Set GEMINI_API_KEY_<number> (preferred) or GEMINI_API_KEY.',
  );
}

// Single Gemini plugin using the primary key from the pool
const geminiPlugin = googleAI({
  apiKey: PRIMARY_GEMINI_API_KEY,
});

export const ai = genkit({
  plugins: [geminiPlugin],
  model: 'googleai/gemini-2.5-flash', // Using 2.5 Flash (stable, better limits)
});

// Helper function to check if error is rate limit or quota
export function isRateLimitError(error: any): boolean {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();

  return (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('quota') ||
    errorMessage.includes('429') ||
    errorMessage.includes('resource exhausted') ||
    errorString.includes('rate limit') ||
    errorString.includes('quota') ||
    errorString.includes('429')
  );
}

function isRetryableKeyError(error: any): boolean {
  return isRateLimitError(error);
}

/**
 * Call Gemini API directly with a specific API key
 */
async function callGeminiDirectly(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string,
): Promise<any> {
  console.log('🔄 Calling Gemini API directly with rotated key...');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${systemInstruction}\n\n${userPrompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Extract text from Gemini response
  if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }

  throw new Error('Invalid Gemini API response format');
}

/**
 * Fallback wrapper that rotates through configured Gemini API keys on rate limit.
 */
export async function withGeminiKeyRotation<T>(
  operation: () => Promise<T>,
  fallbackParams?: {
    systemInstruction: string;
    userPrompt: string;
    parseResponse?: (rawResponse: string) => T;
  },
): Promise<T> {
  try {
    // Try primary key first (through Genkit)
    const result = await operation();
    return result;
  } catch (error) {
    if (!isRetryableKeyError(error)) {
      throw error;
    }

    if (!fallbackParams) {
      console.error(
        '⚠️ No fallback params provided, cannot rotate Gemini keys',
      );
      throw error;
    }

    const fallbackKeys = GEMINI_API_KEY_POOL.slice(1);

    if (fallbackKeys.length === 0) {
      console.error('⚠️ No fallback Gemini API keys configured');
      throw error;
    }

    let lastError: unknown = error;

    for (let index = 0; index < fallbackKeys.length; index++) {
      const keyEntry = fallbackKeys[index];

      try {
        console.warn(
          `❌ Primary/previous Gemini key failed, trying ${keyEntry.label}...`,
        );

        const rawResponse = await callGeminiDirectly(
          keyEntry.apiKey,
          'gemini-2.5-flash',
          fallbackParams.systemInstruction,
          fallbackParams.userPrompt,
        );

        console.log(`✅ Success with ${keyEntry.label}`);

        if (fallbackParams.parseResponse) {
          return fallbackParams.parseResponse(rawResponse);
        }

        return rawResponse as T;
      } catch (rotationError) {
        lastError = rotationError;

        if (!isRetryableKeyError(rotationError)) {
          throw rotationError;
        }
      }
    }

    console.error('❌ All configured Gemini API keys are exhausted');
    throw lastError;
  }
}

// Backward compatibility for existing imports.
export const withDualGeminiFallback = withGeminiKeyRotation;
