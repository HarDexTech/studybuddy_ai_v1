'use server';
import { config } from 'dotenv';
config();

import '@/ai/flows/validate-user-answer.ts';
import '@/ai/flows/generate-single-test-question.ts';
import '@/ai/flows/answer-document-question.ts';
import '@/ai/flows/explain-question.ts';
