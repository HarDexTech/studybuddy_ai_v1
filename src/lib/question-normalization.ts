import type { Question } from '@/lib/types';

const fisherYatesShuffle = <T>(array: T[]): T[] => {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
};

export const normalizeGeneratedQuestion = (question: Question): Question => {
  if (question.type !== 'multiple choice') {
    return question;
  }

  if (!Array.isArray(question.choices) || question.choices.length < 2) {
    return question;
  }

  return {
    ...question,
    choices: fisherYatesShuffle(question.choices),
  };
};

export const normalizeGeneratedQuestions = (
  questions: Question[],
): Question[] => questions.map(normalizeGeneratedQuestion);
