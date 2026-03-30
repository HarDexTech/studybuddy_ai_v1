'use server';
/**
 * @fileOverview Extract a chapter/topic-focused section from a document.
 */

import { ai, withDualGeminiFallback } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractTopicSectionInputSchema = z.object({
  documentContent: z.string().describe('The full text content of the study document.'),
  topicFocus: z.string().describe('The user-provided chapter/topic/keyword focus.'),
});
export type ExtractTopicSectionInput = z.infer<typeof ExtractTopicSectionInputSchema>;

const ExtractTopicSectionOutputSchema = z.object({
  extractedText: z.string().describe('The extracted relevant section text. If no match is found, the full original document text.'),
});
export type ExtractTopicSectionOutput = z.infer<typeof ExtractTopicSectionOutputSchema>;

export async function extractTopicSection(input: ExtractTopicSectionInput): Promise<ExtractTopicSectionOutput> {
  const systemInstruction = 'You are a precise document extraction assistant. Return relevant text verbatim.';

  const userPrompt = `Read the document and identify the section that best matches the user's requested focus.

Focus request: ${input.topicFocus}

Rules:
- Match chapter numbers, unit names, topic names, and keywords.
- Return the matching section text verbatim from the document.
- Do not summarize or paraphrase.
- If no clear matching section exists, return the full original document unchanged.

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Return ONLY valid JSON in this format:
{
  "extractedText": "..."
}`;

  return withDualGeminiFallback(
    async () => {
      return await extractTopicSectionFlow(input);
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

const prompt = ai.definePrompt({
  name: 'extractTopicSectionPrompt',
  input: { schema: ExtractTopicSectionInputSchema },
  output: { schema: ExtractTopicSectionOutputSchema },
  prompt: `You are a precise document extraction assistant.

Read the document and identify the section that best matches the user's requested focus.

Focus request: {{topicFocus}}

Rules:
- Match chapter numbers, unit names, topic names, and keywords.
- Return the matching section text verbatim from the document.
- Do not summarize or paraphrase.
- If no clear matching section exists, return the full original document unchanged.

Document Content:
\`\`\`
{{{documentContent}}}
\`\`\`

Return JSON with a single key: extractedText.
`,
});

const extractTopicSectionFlow = async (input: ExtractTopicSectionInput): Promise<ExtractTopicSectionOutput> => {
  const { output } = await prompt(input, {
    model: 'googleai/gemini-2.5-flash',
  });

  return output!;
};
