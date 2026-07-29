"use server";
/**
 * @fileOverview Generate a single test question.
 */

import { callNimJson } from "@/ai/api";
import { RateLimitPresets, enforceRateLimit } from "@/lib/rate-limit";
import { shuffleMultipleChoiceChoices } from "@/lib/utils";
import { z } from "zod";

const GenerateSingleTestQuestionInputSchema = z.object({
  documentContent: z.string().describe("The text content of the study document."),
  questionTypes: z
    .array(z.enum(["multiple choice", "fill-in-the-blank", "theory", "true or false"]))
    .min(1)
    .describe("The selected question types for generation."),
  difficulty: z.enum(["easy", "medium", "hard"]).describe("The difficulty level of the question."),
  questionSource: z.enum(["strict", "formed"]).describe("The source of the question."),
  existingQuestions: z.array(z.string()).describe("An array of question texts that have already been generated in this test session to avoid duplicates."),
});
export type GenerateSingleTestQuestionInput = z.infer<typeof GenerateSingleTestQuestionInputSchema>;

const AllTypesSchema = z.object({
  type: z.enum(["multiple choice", "fill-in-the-blank", "theory", "true or false"]).describe("The type of question."),
  question: z.string().describe("The question text."),
  choices: z.array(z.string()).optional().describe("The possible answers for multiple choice."),
  correctAnswer: z.union([z.string(), z.boolean()]).optional().describe("The correct answer."),
});

export type GenerateSingleTestQuestionOutput = z.infer<typeof AllTypesSchema>;

const SYSTEM = "You are an expert test generator that creates one high-quality test question from an uploaded document.";

const USER_PROMPT = (input: GenerateSingleTestQuestionInput) => {
  const isStrict = input.questionSource === "strict";
  const isMultiType = input.questionTypes.length > 1;
  const selectedType = input.questionTypes[0];
  const selectedTypesText = input.questionTypes.map((type) => `"${type}"`).join(", ");
  const existingQuestionsText = input.existingQuestions.length > 0 ? input.existingQuestions.map((q) => `- ${q}`).join("\n") : "- (none yet)";

  return `Your main instruction is to generate a single question of the type specified in 'questionType'.

${
  isMultiType
    ? `You must choose one type from this selected list: ${selectedTypesText}.
You MUST set the 'type' field in your response to the chosen question type.`
    : `You MUST generate a '${selectedType}' question. You MUST set the 'type' field to '${selectedType}' in your response.`
}

The question must have a genuine '${input.difficulty}' difficulty level.
- 'easy' questions should be straightforward recall from the text.
- 'medium' questions should require some interpretation or connection of ideas from different parts of the document.
- 'hard' questions should require deep conceptual understanding, synthesis of multiple complex points, or application of knowledge in a new context.

Your instructions for question generation source are as follows:
${isStrict ? `The question and its answer must be taken *strictly* and *literally* from the text. The wording should be as close as possible to the source document.` : `The question should be *formed from* the document's content, allowing for rephrasing, synthesis, and conceptual understanding questions related to the topics. You can create scenarios or examples that test the application of the document's concepts.`}

If the document appears to be a past-question or question-only material where explicit answers are not provided, you should infer the best correct answer using reliable subject knowledge and context from the question itself.
Do not leave a multiple-choice or true-or-false item without a best-answer decision.

You MUST NOT generate a question that is already present in the "Existing Questions" list. Generate a new, unique question.

Existing Questions:
${existingQuestionsText}

**CRITICAL INSTRUCTIONS FOR RESPONSE FORMAT:**
- For **'multiple choice'**: You must provide the question text, an array of 4 choices, and the correct answer (a string that is one of the choices).
- For **'true or false'**: You must provide the question statement and the boolean correct answer.
- For **'fill-in-the-blank'**: You must provide the question sentence containing a blank, like "____".
- For **'theory'**: You must provide an open-ended question.

Document Content:
\`\`\`
${input.documentContent}
\`\`\`

Generate one unique question now. Return ONLY valid JSON with a "type", "question", and the appropriate choice/answer fields. No markdown.`;
};

function parseSingleQuestion(raw: string): GenerateSingleTestQuestionOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse single-question response: ${
        error instanceof Error ? error.message : "unknown error"
      }. Response preview: ${raw.slice(0, 200)}`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof (parsed as { question?: unknown }).question !== "string"
  ) {
    throw new Error(
      `Missing required "question" field. Response preview: ${raw.slice(0, 200)}`,
    );
  }

  const obj = parsed as { type?: unknown; choices?: unknown; correctAnswer?: unknown };

  if (obj.type === "multiple choice") {
    if (!Array.isArray(obj.choices) || obj.choices.length !== 4 || obj.choices.some((c) => typeof c !== "string" || !c.trim())) {
      throw new Error("Multiple-choice question must have exactly 4 non-empty choices.");
    }
    if (typeof obj.correctAnswer !== "string" || !obj.choices.includes(obj.correctAnswer)) {
      throw new Error("Multiple-choice correctAnswer must be one of the choices.");
    }
  } else if (obj.type === "true or false") {
    if (typeof obj.correctAnswer !== "boolean") {
      throw new Error("True/false question must include a boolean correctAnswer.");
    }
  } else if (obj.type !== "theory" && obj.type !== "fill-in-the-blank") {
    throw new Error(`Missing or unsupported "type" field. Response preview: ${raw.slice(0, 200)}`);
  }

  return parsed as GenerateSingleTestQuestionOutput;
}

export async function generateSingleTestQuestion(
  input: GenerateSingleTestQuestionInput,
): Promise<GenerateSingleTestQuestionOutput> {
  await enforceRateLimit(RateLimitPresets.testGeneration);
  const result = await callNimJson(SYSTEM, USER_PROMPT(input), parseSingleQuestion);

  // If only one type was requested the model should already have set it,
  // but we defensively normalize in case it omitted the field.
  if (input.questionTypes.length === 1) {
    const requestedType = input.questionTypes[0];
    if (!result.type) {
      result.type = requestedType;
    }
  }

  return shuffleMultipleChoiceChoices(result);
}
