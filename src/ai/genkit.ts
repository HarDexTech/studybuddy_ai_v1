import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import next from '@genkit-ai/next';

export const ai = genkit({
  plugins: [
    googleAI(),
    next(),
  ],
  // The global model configuration.
  model: 'googleai/gemini-2.5-flash',
  // The global model configuration for streaming requests.
  streamModel: 'googleai/gemini-2.5-flash',
});
