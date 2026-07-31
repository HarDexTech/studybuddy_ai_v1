'use server';
import { config } from 'dotenv';
config();

import '@/ai/flows/validate-user-answer.ts';
import '@/ai/flows/generate-batch-test-questions.ts';
import '@/ai/flows/answer-document-question.ts';
import '@/ai/flows/explain-question.ts';
import '@/ai/flows/extract-topic-section.ts';
import '@/ai/flows/generate-document-summary.ts';
import '@/ai/flows/generate-cross-document-questions.ts';
