'use server';
/**
 * @fileOverview Extract the document section most relevant to a user-provided chapter/topic focus.
 */

import { ai, withDualGeminiFallback } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractTopicSectionInputSchema = z.object({
  documentContent: z
    .string()
    .describe('The full text content of the uploaded document.'),
  topicFocus: z
    .string()
    .describe(
      'The user-provided chapter/topic/section hint (e.g., Chapter 3, Photosynthesis, Unit 2).',
    ),
});

export type ExtractTopicSectionInput = z.infer<
  typeof ExtractTopicSectionInputSchema
>;

const ExtractTopicSectionOutputSchema = z.object({
  extractedText: z
    .string()
    .describe(
      'The section of the document most relevant to the requested topic focus.',
    ),
});

export type ExtractTopicSectionOutput = z.infer<
  typeof ExtractTopicSectionOutputSchema
>;

const prompt = ai.definePrompt({
  name: 'extractTopicSectionPrompt',
  input: { schema: ExtractTopicSectionInputSchema },
  output: { schema: ExtractTopicSectionOutputSchema },
  prompt: `You are a precise document section extractor.

Your task:
- Read the provided document content.
- Find the section that best matches the user's requested chapter/topic/section hint.
- The hint may be a chapter number, topic name, keyword phrase, section title, or page-range style hint.

Rules:
1. Return the matching section as verbatim or near-verbatim text from the document.
2. Do not invent new facts or summarize with unrelated content.
3. If no reliable matching section is found, return the FULL original document content unchanged.

User Focus:
{{topicFocus}}

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`
`,
});

export async function extractTopicSection(
  input: ExtractTopicSectionInput,
): Promise<ExtractTopicSectionOutput> {
  const systemInstruction =
    'You are a precise document section extractor. Return only relevant text from the provided document.';

  const userPrompt = `Read the document and find the section that best matches this focus:
"${input.topicFocus}"

Rules:
1. Return matching section text verbatim or near-verbatim.
2. Do not invent content.
3. If no reliable match exists, return the full original document text unchanged.

Return ONLY valid JSON in this format:
{
  "extractedText": "..."
}

Document Content:
\`\`\`
${input.documentContent}
\`\`\``;

  return withDualGeminiFallback(
    async () => {
      const { output } = await prompt(input, {
        model: 'googleai/gemini-2.5-flash',
      });
      return output!;
    },
    {
      systemInstruction,
      userPrompt,
      parseResponse: (rawResponse: string) => {
        const cleaned = rawResponse
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        return JSON.parse(cleaned) as ExtractTopicSectionOutput;
      },
    },
  );
}
