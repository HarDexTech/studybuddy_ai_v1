export type QuestionType = 'multiple choice' | 'fill-in-the-blank' | 'theory' | 'true or false';

export interface BaseQuestion {
  question: string;
  type: QuestionType;
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
}
