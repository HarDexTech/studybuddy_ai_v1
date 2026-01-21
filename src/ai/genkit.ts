import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Single Gemini plugin using primary API key
const geminiPlugin = googleAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const ai = genkit({
  plugins: [geminiPlugin],
  model: 'googleai/gemini-2.0-flash-exp', // Using 2.0 Flash (free tier: 1500 RPD, 15 RPM)
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

/**
 * Call Gemini API directly with second API key
 */
async function callGeminiDirectly(
  model: string,
  systemInstruction: string,
  userPrompt: string
): Promise<any> {
  console.log('🔄 Calling Gemini API directly with secondary key...');
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY_2}`,
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
                text: `${systemInstruction}\n\n${userPrompt}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      })
    }
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
 * Fallback wrapper that switches to second Gemini API key on rate limit
 */
export async function withDualGeminiFallback<T>(
  operation: () => Promise<T>,
  fallbackParams?: {
    systemInstruction: string;
    userPrompt: string;
    parseResponse?: (rawResponse: string) => T;
  }
): Promise<T> {
  try {
    // Try with primary key first (through Genkit)
    const result = await operation();
    return result;
  } catch (error) {
    // If rate limited, try with secondary key
    if (isRateLimitError(error)) {
      console.warn('❌ Primary Gemini API key rate limited, switching to secondary...');
      
      if (!fallbackParams) {
        console.error('⚠️  No fallback params provided, cannot use secondary key');
        throw error;
      }
      
      try {
        const rawResponse = await callGeminiDirectly(
          'gemini-2.0-flash-exp',
          fallbackParams.systemInstruction,
          fallbackParams.userPrompt
        );
        
        console.log('✅ Success with secondary Gemini API key');
        
        // Parse the response if parser provided
        if (fallbackParams.parseResponse) {
          return fallbackParams.parseResponse(rawResponse);
        }
        
        return rawResponse as T;
      } catch (secondError) {
        console.error('❌ Both Gemini API keys exhausted');
        throw secondError;
      }
    }
    
    throw error;
  }
}