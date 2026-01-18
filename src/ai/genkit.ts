import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { openAI } from "genkitx-openai";

// Primary: Gemini API (your existing free tier)
const geminiPlugin = googleAI();

// Fallback: OpenRouter with free models
const openRouterPlugin = openAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export const ai = genkit({
  plugins: [geminiPlugin, openRouterPlugin],
  // Default to Gemini (your existing setup)
  model: "googleai/gemini-2.5-flash",
});

// Model configuration with fallback
export const MODEL_CONFIG = {
  primary: {
    name: "googleai/gemini-2.5-flash",
    provider: "gemini",
  },
  fallbacks: [
    {
      name: "google/gemini-flash-1.5",
      provider: "openrouter",
    },
    {
      name: "meta-llama/llama-3.1-70b-instruct",
      provider: "openrouter",
    },
    {
      name: "meta-llama/llama-3.1-8b-instruct",
      provider: "openrouter",
    },
  ],
};

// Helper function to check if error is rate limit or quota
export function isRateLimitError(error: any): boolean {
  const errorMessage = error?.message?.toLowerCase() || "";
  const errorString = String(error).toLowerCase();

  return (
    errorMessage.includes("rate limit") ||
    errorMessage.includes("quota") ||
    errorMessage.includes("429") ||
    errorMessage.includes("resource exhausted") ||
    errorString.includes("rate limit") ||
    errorString.includes("quota") ||
    errorString.includes("429")
  );
}

// Helper to get next fallback model
let currentFallbackIndex = -1;

export function getNextModel(): string | null {
  currentFallbackIndex++;
  if (currentFallbackIndex < MODEL_CONFIG.fallbacks.length) {
    return MODEL_CONFIG.fallbacks[currentFallbackIndex].name;
  }
  return null;
}

export function resetFallback(): void {
  currentFallbackIndex = -1;
}

export function getCurrentModel(): string {
  if (currentFallbackIndex === -1) {
    return MODEL_CONFIG.primary.name;
  }
  return (
    MODEL_CONFIG.fallbacks[currentFallbackIndex]?.name ||
    MODEL_CONFIG.primary.name
  );
}
