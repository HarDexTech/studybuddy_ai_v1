import { ai, isRateLimitError, getNextModel, resetFallback, getCurrentModel } from './genkit';

/**
 * Retry wrapper that automatically falls back to OpenRouter if Gemini fails
 * @param operation - The AI operation to execute
 * @param maxRetries - Maximum number of fallback attempts
 */
export async function withFallback<T>(
  operation: (model: string) => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: any;
  
  // Reset to primary model
  resetFallback();
  
  // Try primary model first (Gemini)
  try {
    const result = await operation(getCurrentModel());
    return result;
  } catch (error) {
    lastError = error;
    
    // Check if it's a rate limit error
    if (!isRateLimitError(error)) {
      // If not rate limit, throw the error
      throw error;
    }
    
    console.warn('Gemini rate limit hit, switching to OpenRouter fallback...');
  }
  
  // Try fallback models (OpenRouter)
  for (let i = 0; i < maxRetries; i++) {
    const fallbackModel = getNextModel();
    
    if (!fallbackModel) {
      // No more fallbacks available
      console.error('All fallback models exhausted');
      throw lastError;
    }
    
    try {
      console.log(`Attempting fallback model: ${fallbackModel}`);
      const result = await operation(fallbackModel);
      console.log(`Success with fallback model: ${fallbackModel}`);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`Fallback model ${fallbackModel} failed:`, error);
      
      // If this fallback also hit rate limit, try next one
      if (isRateLimitError(error)) {
        continue;
      } else {
        // If it's a different error, throw it
        throw error;
      }
    }
  }
  
  // All attempts failed
  throw lastError;
}
