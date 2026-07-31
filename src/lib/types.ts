export type QuestionType = 'multiple choice' | 'fill-in-the-blank' | 'theory' | 'true or false';

export interface BaseQuestion {
  question: string;
  type: QuestionType;
  sourceDoc?: string;
}

export interface MultipleChoiceQuestion extends BaseQuestion {
  type: 'multiple choice';
  choices: string[];
  correctAnswer: string;
}

export interface TrueFalseQuestion extends BaseQuestion {
  type: 'true or false';
  correctAnswer: boolean;
}

export interface FillInTheBlankQuestion extends BaseQuestion {
  type: 'fill-in-the-blank';
}

export interface TheoryQuestion extends BaseQuestion {
  type: 'theory';
}

export type Question = MultipleChoiceQuestion | TrueFalseQuestion | FillInTheBlankQuestion | TheoryQuestion;

export interface TestSettings {
  questionType: QuestionType[];
  numberOfQuestions: number;
  timerEnabled: boolean;
  timerDuration: number; // in minutes
  difficulty: 'easy' | 'medium' | 'hard';
  questionSource: 'strict' | 'formed';
  topicFocus?: string;
  pastQuestionSetIds?: string[];
  prioritizeExamTopics?: boolean;
  reusePastQuestions?: boolean;
  priorityTopics?: string[];
  seedQuestions?: string[];
}

export interface TestResult {
  question: Question;
  userAnswer: string;
  isCorrect: boolean;
  feedback: string;
}

export interface CachedDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  text: string;
  structuredText?: string;
}

export interface PastQuestionSet {
  id: string;
  name: string;
  text: string;
  uploadedAt: number;
}

export interface StoredTestProgress {
  docSignature?: string;
  settingsSignature?: string;
  documentInfo?: {
    text: string;
    file?: { name: string; type: string; size: number };
  };
  settings?: unknown;
  effectiveDocumentText?: string;
  currentQuestionIndex?: number;
  userAnswer?: string;
  results?: unknown[];
  currentResult?: { isCorrect: boolean; feedback: string } | null;
  isAnswered?: boolean;
  timeLeft?: number | null;
  questions?: unknown[];
  generatedQuestionCount?: number;
}
