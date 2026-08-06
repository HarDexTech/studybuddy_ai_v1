"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { generateBatchTestQuestions } from "@/ai/flows/generate-batch-test-questions";
import {
  validateUserAnswer,
  type ValidateUserAnswerOutput,
} from "@/ai/flows/validate-user-answer";
import { explainQuestion } from "@/ai/flows/explain-question";
import type {
  TestResult,
  TestSettings,
  Question,
  MultipleChoiceQuestion,
  TrueFalseQuestion,
} from "@/lib/types";
import { PASS_THRESHOLD } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Timer,
  Hourglass,
  LogOut,
  Sparkles,
  HelpCircle,
  FileText,
  ChevronLeft,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { clearTestProgress, saveTestProgress } from "@/lib/storage";
import { createChunkRotator, gradeFillInTheBlank } from "@/lib/utils";

type TestViewProps = {
  initialQuestions: Question[];
  documentInfo: { text: string };
  effectiveDocumentText: string;
  settings: TestSettings;
  onTestFinished: (results: TestResult[], totalGenerated: number) => void;
  showRestoreNotice?: boolean;
  onBack: () => void;
  restoreSnapshot?: {
    questions: Question[];
    currentQuestionIndex: number;
    userAnswer: string;
    results: TestResult[];
    currentResult: {
      isCorrect: boolean;
      score: number;
      feedback: string;
    } | null;
    isAnswered: boolean;
    timeLeft: number | null;
    generatedQuestionCount: number;
  } | null;
};

const validationSteps = [
  "Analyzing your answer...",
  "Comparing with the document...",
  "Finalizing feedback...",
];

const BATCH_SIZE = 2;
const BATCH_TIMEOUT = 30000; // 30 seconds for batch
const FIRST_QUESTION_TIMEOUT = 10000; // 10 seconds for instant first question
const VALIDATION_TIMEOUT = 30000; // 30 seconds for answer validation
const MAX_RETRIES = 1;

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const normalizeQuestionText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const appendUniqueQuestions = (
  existingQuestions: Question[],
  incomingQuestions: Question[],
) => {
  const seen = new Set(
    existingQuestions.map((question) =>
      normalizeQuestionText(question.question),
    ),
  );
  const uniqueIncoming = incomingQuestions.filter((question) => {
    const normalized = normalizeQuestionText(question.question);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });

  return [...existingQuestions, ...uniqueIncoming];
};

function AskAiDialog({
  open,
  onOpenChange,
  documentText,
  question,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentText: string;
  question: Question;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      // Note: Timer does NOT pause for Ask AI dialog
      handleAskAi();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleAskAi = async () => {
    setIsLoading(true);
    setExplanation(null);
    try {
      const correctAnswer =
        "correctAnswer" in question
          ? String(question.correctAnswer)
          : "N/A for this question type";

      const result = await explainQuestion({
        documentContent: documentText,
        question: question.question,
        correctAnswer: correctAnswer,
      });
      setExplanation(result.explanation);
    } catch (error) {
      console.error("Ask AI Error:", error);
      const errorMessage =
        (error as Error)?.message || "An unknown error occurred.";
      toast({
        variant: "destructive",
        title: "Error Getting Explanation",
        description: errorMessage,
      });
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Explanation
          </DialogTitle>
          <DialogDescription>
            Here's a detailed breakdown of the question and answer.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Asking AI for help...</span>
            </div>
          )}
          {explanation && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-4">
              <div>
                <h4 className="font-semibold">Question:</h4>
                <p className="text-sm">{question.question}</p>
              </div>
              <div>
                <h4 className="font-semibold">Explanation:</h4>
                <p className="text-sm whitespace-pre-wrap">{explanation}</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TestView({
  initialQuestions,
  documentInfo,
  effectiveDocumentText,
  settings,
  onTestFinished,
  showRestoreNotice = false,
  restoreSnapshot = null,
  onBack,
}: TestViewProps) {
  const { toast, dismiss } = useToast();
  const [questions, setQuestions] = useState<Question[]>(() => {
    if (
      restoreSnapshot &&
      Array.isArray(restoreSnapshot.questions) &&
      restoreSnapshot.questions.length > 0
    ) {
      return restoreSnapshot.questions;
    }
    return shuffleArray(initialQuestions);
  });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(() => {
    if (restoreSnapshot && restoreSnapshot.questions.length > 0) {
      return Math.max(
        0,
        Math.min(
          restoreSnapshot.currentQuestionIndex,
          restoreSnapshot.questions.length - 1,
        ),
      );
    }
    return 0;
  });
  const [userAnswer, setUserAnswer] = useState(() =>
    restoreSnapshot ? restoreSnapshot.userAnswer : "",
  );
  const [results, setResults] = useState<TestResult[]>(() =>
    restoreSnapshot ? restoreSnapshot.results : [],
  );
  const [currentResult, setCurrentResult] =
    useState<ValidateUserAnswerOutput | null>(() =>
      restoreSnapshot ? restoreSnapshot.currentResult : null,
    );
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [isAnswered, setIsAnswered] = useState(() =>
    restoreSnapshot ? restoreSnapshot.isAnswered : false,
  );

  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(() => {
    if (restoreSnapshot) {
      return restoreSnapshot.timeLeft;
    }
    return settings.timerEnabled && settings.timerDuration
      ? settings.timerDuration * 60
      : null;
  });

  const backgroundGenerationStarted = useRef(false);
  const generationErrorToastId = useRef<string | null>(null);
  const chunkRotator = useRef<(() => string) | null>(null);
  const instantFirstDone = useRef(false);
  const lastSyncedQuestion = useRef<string | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const [isAskAiDialogOpen, setIsAskAiDialogOpen] = useState(false);
  const [validationSubmitError, setValidationSubmitError] = useState<
    string | null
  >(null);
  const [sessionRestored, setSessionRestored] = useState(showRestoreNotice);

  const totalQuestionsToGenerate = settings.numberOfQuestions;
  const currentQuestion = questions[currentQuestionIndex] ?? questions[0];

  if (questions.length === 0) {
    return (
      <div className="w-full max-w-3xl mx-auto flex-grow flex flex-col justify-center items-center space-y-4">
        <p className="text-muted-foreground">
          Failed to load questions. Please go back and try again.
        </p>
        <Button onClick={() => onTestFinished([], 0)}>Go Back</Button>
      </div>
    );
  }

  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const timerCallback = useRef<() => void>();

  const upsertResult = useCallback(
    (previousResults: TestResult[], nextResult: TestResult) => {
      const existingIndex = previousResults.findIndex(
        (result) => result.question.question === nextResult.question.question,
      );

      if (existingIndex === -1) {
        return [...previousResults, nextResult];
      }

      const updatedResults = [...previousResults];
      updatedResults[existingIndex] = nextResult;
      return updatedResults;
    },
    [],
  );

  const finishTest = useCallback(
    (partialResults: TestResult[], reason: string) => {
      clearTestProgress().catch((err) =>
        console.error("Failed to clear test progress:", err),
      );

      // Pad missing questions (skipped or never reached) so the results
      // always contain every generated question.
      const paddedResults = [...partialResults];
      const answeredQuestions = new Set(
        paddedResults.map((r) => r.question.question),
      );

      questions.forEach((q) => {
        if (!answeredQuestions.has(q.question)) {
          paddedResults.push({
            question: q,
            userAnswer: "",
            isCorrect: false,
            score: 0,
            feedback: reason,
          });
          answeredQuestions.add(q.question);
        }
      });

      onTestFinished(paddedResults, questions.length);
    },
    [onTestFinished, questions],
  );

  useEffect(() => {
    setSessionRestored(showRestoreNotice);
    if (showRestoreNotice) {
      toast({
        title: "Test session restored",
        description: "Your previous test progress has been recovered.",
      });
    }
  }, [showRestoreNotice, toast]);

  useEffect(() => {
    if (!restoreSnapshot) {
      return;
    }

    const generatedCount = restoreSnapshot.generatedQuestionCount;
    if (
      generatedCount >= totalQuestionsToGenerate ||
      questions.length >= totalQuestionsToGenerate
    ) {
      backgroundGenerationStarted.current = true;
    }
  }, [restoreSnapshot, questions.length, totalQuestionsToGenerate]);

  useEffect(() => {
    const payload = {
      docSignature: `${documentInfo.text.length}:${documentInfo.text.slice(0, 120)}`,
      settingsSignature: JSON.stringify(settings),
      documentInfo,
      settings,
      effectiveDocumentText,
      currentQuestionIndex,
      userAnswer,
      results,
      currentResult,
      isAnswered,
      timeLeft,
      questions,
      generatedQuestionCount: questions.length,
    };

    saveTestProgress(payload).catch((err) =>
      console.error("Failed to persist test progress:", err),
    );
  }, [
    documentInfo.text,
    documentInfo,
    effectiveDocumentText,
    settings,
    currentQuestionIndex,
    userAnswer,
    results,
    currentResult,
    isAnswered,
    timeLeft,
    questions,
  ]);

  // Check if next question is ready
  const isNextQuestionReady = questions.length > currentQuestionIndex + 1;
  const isTestFinished = currentQuestionIndex >= totalQuestionsToGenerate - 1;

  // Timer should pause ONLY when waiting for next question after submit
  const shouldPauseTimer =
    isAnswered && !isNextQuestionReady && !isTestFinished;

  // Timer logic
  useEffect(() => {
    timerCallback.current = () => {
      // Pause timer if waiting for next question
      if (isLoading || shouldPauseTimer) {
        setIsTimerPaused(true);
        return;
      }

      setIsTimerPaused(false);

      setTimeLeft((prev) => {
        if (prev === null) return null;
        if (prev > 1) {
          return prev - 1;
        }

        // Timer is at 1, about to hit 0. Finish the test.
        // Append the current question if it wasn't answered so its feedback
        // reads "Time ran out..." instead of the generic skip reason.
        let finalResults = [...results];
        const answeredQuestions = new Set(
          finalResults.map((r) => r.question.question),
        );

        if (
          currentQuestion &&
          !answeredQuestions.has(currentQuestion.question)
        ) {
          finalResults.push({
            question: currentQuestion,
            userAnswer: "",
            isCorrect: false,
            score: 0,
            feedback: "Time ran out and this question was skipped.",
          });
          answeredQuestions.add(currentQuestion.question);
        }

        finishTest(finalResults, "Time ran out before reaching this question.");
        return 0;
      });
    };
  }, [
    isLoading,
    shouldPauseTimer,
    results,
    currentQuestion,
    questions,
    finishTest,
  ]);

  useEffect(() => {
    if (!settings.timerEnabled) {
      return;
    }

    const intervalId = setInterval(() => {
      timerCallback.current?.();
    }, 1000);

    return () => clearInterval(intervalId);
  }, [settings.timerEnabled]);

  // Smart background question generation with batching
  useEffect(() => {
    const generateRemainingQuestions = async () => {
      if (
        backgroundGenerationStarted.current ||
        questions.length >= totalQuestionsToGenerate
      ) {
        return;
      }
      backgroundGenerationStarted.current = true;

      chunkRotator.current ??= createChunkRotator(
        effectiveDocumentText,
        Math.max(8, Math.min(totalQuestionsToGenerate, 24)),
      );

      let currentGeneratedQuestions = [...questions];
      let retryCount = 0;

      for (
        let i = currentGeneratedQuestions.length;
        i < totalQuestionsToGenerate;
      ) {
        // Pause generation if validation is in progress
        while (isLoading) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const remaining = totalQuestionsToGenerate - i;
        setIsGenerating(true);

        try {
          // Instant first question: generate 1 question quickly so user can start
          let batchSize: number;
          let currentTimeout: number;
          if (!instantFirstDone.current && currentGeneratedQuestions.length <= settings.numberOfQuestions / 3) {
            batchSize = 1;
            currentTimeout = FIRST_QUESTION_TIMEOUT;
            instantFirstDone.current = true;
          } else {
            batchSize = Math.min(remaining, BATCH_SIZE);
            currentTimeout = BATCH_TIMEOUT;
          }
          console.log(`Generating batch of ${batchSize} questions...`);

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Batch generation timeout")),
              currentTimeout,
            ),
          );

          const generationPromise = generateBatchTestQuestions({
            documentContent: chunkRotator.current(),
            questionTypes: settings.questionType,
            difficulty: settings.difficulty,
            questionSource: settings.questionSource,
            existingQuestions: currentGeneratedQuestions.map(
              (q) => q.question,
            ),
            batchSize,
            priorityTopics: settings.priorityTopics,
            seedQuestions: settings.seedQuestions,
          });

          const result = (await Promise.race([
            generationPromise.then((r) => ({
              questions: r.questions as Question[],
            })),
            timeoutPromise,
          ])) as { questions: Question[] };

          if (generationErrorToastId.current) {
            dismiss(generationErrorToastId.current);
            generationErrorToastId.current = null;
          }

          const mergedQuestions = appendUniqueQuestions(
            currentGeneratedQuestions,
            result.questions,
          );
          const addedCount =
            mergedQuestions.length - currentGeneratedQuestions.length;

          if (addedCount === 0) {
            console.warn("Batch produced only duplicates — skipping to next batch.");
            i += batchSize;
            continue;
          }

          currentGeneratedQuestions = mergedQuestions;
          setQuestions([...currentGeneratedQuestions]);
          setGenerationProgress({ current: currentGeneratedQuestions.length, total: totalQuestionsToGenerate });
          i += addedCount;
          retryCount = 0;
        } catch (error) {
          console.error("Failed to generate question(s):", error);
          const errorMessage =
            (error as Error)?.message || "An unknown error occurred.";
          const isTemporaryUnavailable = errorMessage.includes(
            "AI_TEMP_UNAVAILABLE",
          );
          const isRateLimitError = errorMessage.includes("429");
          const isServiceUnavailable =
            errorMessage.includes("503") ||
            errorMessage.toLowerCase().includes("overloaded");
          const isTimeout = errorMessage.includes("timeout");
          const isNetworkError =
            errorMessage.toLowerCase().includes("network") ||
            errorMessage.toLowerCase().includes("fetch") ||
            errorMessage.toLowerCase().includes("econnreset") ||
            errorMessage.toLowerCase().includes("etimedout") ||
            errorMessage.toLowerCase().includes("enotfound");

          if (isRateLimitError) {
            toast({
              variant: "destructive",
              title: "AI Rate Limit Reached",
              description: `You've exceeded the API quota. Generated ${currentGeneratedQuestions.length}/${totalQuestionsToGenerate} questions.`,
            });
            break; // Stop trying
          } else if (
            isTemporaryUnavailable ||
            isServiceUnavailable ||
            isTimeout ||
            isNetworkError
          ) {
            // Retry logic
            if (retryCount < MAX_RETRIES) {
              retryCount++;
              if (!generationErrorToastId.current) {
                const { id } = toast({
                  variant: "destructive",
                  title: "AI Service Temporarily Unavailable",
                  description: `Retrying shortly... (Attempt ${retryCount}/${MAX_RETRIES})`,
                });
                generationErrorToastId.current = id;
              }
              await new Promise((resolve) => setTimeout(resolve, 1200));
              // Don't increment i, will retry same question
            } else {
              toast({
                variant: "destructive",
                title: "Question Generation Failed",
                description: `Continuing with ${currentGeneratedQuestions.length} questions. The AI service is temporarily unavailable.`,
              });
              break; // Stop trying after max retries
            }
          } else {
            toast({
              variant: "destructive",
              title: "Question Generation Failed",
              description: `Continuing with ${currentGeneratedQuestions.length} questions due to a generation error.`,
            });
            break; // Stop trying
          }
        } finally {
          setIsGenerating(false);
        }
      }

      setGenerationProgress(null);

      if (generationErrorToastId.current) {
        dismiss(generationErrorToastId.current);
        generationErrorToastId.current = null;
      }
    };

    generateRemainingQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, effectiveDocumentText]);

  useEffect(() => {
    const question = questions[currentQuestionIndex];
    if (!question) {
      return;
    }

    const matchedResult = results.find(
      (result) => result.question.question === question.question,
    );

    if (matchedResult) {
      setIsAnswered(true);
      setCurrentResult({
        isCorrect: matchedResult.isCorrect,
        score:
          typeof matchedResult.score === "number"
            ? matchedResult.score
            : matchedResult.isCorrect
              ? 100
              : 0,
        feedback: matchedResult.feedback,
      });
      setUserAnswer(matchedResult.userAnswer);
      setValidationSubmitError(null);
      lastSyncedQuestion.current = question.question;
      return;
    }

    // The questions array grows as background generation completes batches.
    // If the displayed question hasn't changed, don't wipe the user's
    // in-progress answer.
    if (lastSyncedQuestion.current === question.question) {
      return;
    }

    setUserAnswer(draftsRef.current[question.question] ?? "");
    setCurrentResult(null);
    setIsAnswered(false);
    setValidationSubmitError(null);
    lastSyncedQuestion.current = question.question;
  }, [currentQuestionIndex, questions, results]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isLoading) {
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % validationSteps.length);
      }, 2000);
    }
    return () => {
      if (interval !== undefined) clearInterval(interval);
    };
  }, [isLoading]);

  const handleAnswerSubmit = async () => {
    setValidationSubmitError(null);

    if (
      !userAnswer &&
      (currentQuestion.type === "multiple choice" ||
        currentQuestion.type === "true or false")
    ) {
      toast({
        variant: "destructive",
        title: "No Answer Selected",
        description: "Please select an option before submitting.",
      });
      return;
    }
    if (isLoading || isAnswered) return;

    setIsLoading(true);
    setLoadingStep(0);

    try {
      let validationResult: ValidateUserAnswerOutput | null = null;

      if (currentQuestion.type === "multiple choice") {
        const isCorrect =
          userAnswer ===
          (currentQuestion as MultipleChoiceQuestion).correctAnswer;
        const feedback = isCorrect
          ? "Correct!"
          : `Incorrect. The correct answer is ${(currentQuestion as MultipleChoiceQuestion).correctAnswer}.`;
        validationResult = {
          isCorrect,
          score: isCorrect ? 100 : 0,
          feedback,
        };
      } else if (currentQuestion.type === "true or false") {
        const isCorrect =
          userAnswer ===
          String((currentQuestion as TrueFalseQuestion).correctAnswer);
        const feedback = isCorrect
          ? "Correct!"
          : `Incorrect. The correct answer is ${String((currentQuestion as TrueFalseQuestion).correctAnswer)}.`;
        validationResult = {
          isCorrect,
          score: isCorrect ? 100 : 0,
          feedback,
        };
      } else if (currentQuestion.type === "fill-in-the-blank") {
        const correctAnswer =
          "correctAnswer" in currentQuestion
            ? String(currentQuestion.correctAnswer)
            : "";
        validationResult = gradeFillInTheBlank(userAnswer, correctAnswer);
      }

      if (!validationResult) {
        let attempt = 0;
        let lastError: unknown = null;

        while (attempt <= MAX_RETRIES) {
          try {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Validation timeout")),
                VALIDATION_TIMEOUT,
              ),
            );

            validationResult = await Promise.race([
              validateUserAnswer({
                documentContent: documentInfo.text,
                question: currentQuestion.question,
                userAnswer: userAnswer,
                correctAnswer:
                  "correctAnswer" in currentQuestion
                    ? String(currentQuestion.correctAnswer)
                    : "",
                questionSource: settings.questionSource,
              }),
              timeoutPromise,
            ]);

            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const errorMessage = (
              (error as Error)?.message || ""
            ).toLowerCase();
            const isRetryableError =
              errorMessage.includes("ai_temp_unavailable") ||
              errorMessage.includes("timeout") ||
              errorMessage.includes("fetch") ||
              errorMessage.includes("network") ||
              errorMessage.includes("503") ||
              errorMessage.includes("server") ||
              errorMessage.includes("econnreset") ||
              errorMessage.includes("etimedout") ||
              errorMessage.includes("enotfound") ||
              errorMessage.includes("overloaded");

            if (!isRetryableError || attempt >= MAX_RETRIES) {
              throw error;
            }

            attempt++;
            toast({
              variant: "destructive",
              title: "Validation Failed",
              description: `Retrying validation... (${attempt}/${MAX_RETRIES})`,
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }

        if (lastError) {
          throw lastError;
        }
      }

      if (!validationResult) {
        throw new Error("Validation did not return a result.");
      }

      setCurrentResult(validationResult);
      setResults((prev) =>
        upsertResult(prev, {
          question: currentQuestion,
          userAnswer: userAnswer,
          ...validationResult,
        }),
      );
      delete draftsRef.current[currentQuestion.question];
      setIsAnswered(true);
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: (error as Error)?.message?.includes("AI_TEMP_UNAVAILABLE")
          ? "AI service is temporarily unavailable. Please retry in a moment."
          : "Validation failed. Please submit again.",
      });

      setValidationSubmitError(
        "Validation failed after retry. Please submit again.",
      );

      setCurrentResult(null);
      setIsAnswered(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDraftChange = useCallback(
    (value: string) => {
      if (!currentQuestion) return;
      draftsRef.current[currentQuestion.question] = value;
      setUserAnswer(value);
    },
    [currentQuestion],
  );

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  };

  const handleNextSkip = () => {
    if (currentQuestionIndex < totalQuestionsToGenerate - 1) {
      if (isNextQuestionReady) {
        setCurrentQuestionIndex((prev) => prev + 1);
      }
      return;
    }

    finishTest(results, "This question was skipped.");
  };

  const handleNext = () => {
    if (currentQuestionIndex < totalQuestionsToGenerate - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    } else {
      finishTest(results, "This question was skipped.");
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inTextarea = target instanceof HTMLTextAreaElement;

      // While typing in a textarea: Enter submits, Shift/Ctrl+Enter inserts a
      // new line (default behavior), arrow keys move the cursor.
      if (inTextarea) {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          if (isLoading) return;
          event.preventDefault();
          if (isAnswered) {
            nextButtonRef.current?.click();
          } else {
            submitButtonRef.current?.click();
          }
        }
        return;
      }

      // Arrow keys navigate between questions but never submit the test.
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (isLoading) return;
        event.preventDefault();
        const targetIndex =
          event.key === "ArrowRight"
            ? currentQuestionIndex + 1
            : currentQuestionIndex - 1;
        if (targetIndex >= 0 && targetIndex < questions.length) {
          setCurrentQuestionIndex(targetIndex);
        }
        return;
      }

      if (isAnswered) {
        if (event.key === "Enter") {
          event.preventDefault();
          nextButtonRef.current?.click();
        }
        return;
      }

      if (isLoading) return;

      const isMcqOrTf =
        currentQuestion.type === "multiple choice" ||
        currentQuestion.type === "true or false";
      const isText =
        currentQuestion.type === "fill-in-the-blank" ||
        currentQuestion.type === "theory";
      const key = event.key.toLowerCase();

      if (
        currentQuestion.type === "multiple choice" &&
        !isAnswered &&
        !isLoading &&
        ["a", "b", "c", "d"].includes(key)
      ) {
        event.preventDefault();
        const indexByKey: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
        const selectedChoice = (currentQuestion as MultipleChoiceQuestion)
          .choices[indexByKey[key]];

        if (selectedChoice) {
          handleDraftChange(selectedChoice);
        }
        return;
      }

      if (isMcqOrTf && event.key === "Enter") {
        event.preventDefault();
        submitButtonRef.current?.click();
      } else if (isText && event.key === "Enter") {
        event.preventDefault();
        submitButtonRef.current?.click();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAnswered, isLoading, currentQuestion, currentQuestionIndex, questions.length, handleDraftChange]);

  const handleQuit = () => {
    finishTest(results, "The test was quit before reaching this question.");
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const renderAnswerInput = () => {
    switch (currentQuestion.type) {
      case "multiple choice":
        const mcq = currentQuestion as MultipleChoiceQuestion;
        return (
          <RadioGroup
            value={userAnswer}
            onValueChange={handleDraftChange}
            disabled={isAnswered || isLoading}
            className="space-y-2"
          >
            {mcq.choices.map((choice, index) => (
              <div
                key={index}
                className="flex items-center space-x-3 p-3 rounded-md border border-input has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <RadioGroupItem value={choice} id={`choice-${index}`} />
                <Label
                  htmlFor={`choice-${index}`}
                  className="flex-1 cursor-pointer"
                >
                  {choice}
                </Label>
              </div>
            ))}
          </RadioGroup>
        );
      case "true or false":
        return (
          <div className="flex flex-col sm:flex-row gap-4">
            <Button
              variant={userAnswer === "true" ? "default" : "outline"}
              onClick={() => handleDraftChange("true")}
              disabled={isAnswered || isLoading}
              className="flex-1 h-12 text-lg"
            >
              True
            </Button>
            <Button
              variant={userAnswer === "false" ? "default" : "outline"}
              onClick={() => handleDraftChange("false")}
              disabled={isAnswered || isLoading}
              className="flex-1 h-12 text-lg"
            >
              False
            </Button>
          </div>
        );
      case "fill-in-the-blank":
      case "theory":
      default:
        return (
          <Textarea
            placeholder="Your answer here... (Enter to submit, Shift+Enter or Ctrl+Enter for new line)"
            value={userAnswer}
            onChange={(e) => handleDraftChange(e.target.value)}
            rows={5}
            disabled={isAnswered || isLoading}
          />
        );
    }
  };

  const questionsAvailable = questions.length;

  return (
    <div className="w-full max-w-3xl mx-auto flex-grow flex flex-col justify-center space-y-4">
      <Button
        onClick={onBack}
        variant="ghost"
        size="sm"
        className="gap-1 self-start"
        disabled={isLoading || isGenerating}
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </Button>
      {currentQuestion && (
        <AskAiDialog
          open={isAskAiDialogOpen}
          onOpenChange={setIsAskAiDialogOpen}
          documentText={documentInfo.text}
          question={currentQuestion}
        />
      )}

      {sessionRestored && (
        <Alert className="border-primary/40 bg-primary/5">
          <AlertTitle>Test session restored</AlertTitle>
          <AlertDescription>
            Your previous progress has been recovered from this device.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between items-center gap-4">
        <div className="flex items-center gap-4 ml-auto">
          {timeLeft !== null && (
            <div className="flex items-center gap-2 text-lg font-semibold text-primary shrink-0">
              {shouldPauseTimer || isTimerPaused ? (
                <Hourglass className="h-5 w-5" />
              ) : (
                <Timer className="h-5 w-5" />
              )}
              <span>{formatTime(timeLeft)}</span>
            </div>
          )}
        </div>
      </div>
      <Card
        className="w-full animate-in fade-in-50 duration-500"
        key={currentQuestionIndex}
      >
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-2xl font-headline">
              Question {currentQuestionIndex + 1} of {totalQuestionsToGenerate}
            </CardTitle>
            {questionsAvailable < totalQuestionsToGenerate && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  Generating questions... ({questionsAvailable}/
                  {totalQuestionsToGenerate})
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-lg font-medium">{currentQuestion.question}</p>

          {currentQuestion.sourceDoc && (
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Based on: {currentQuestion.sourceDoc}
              </span>
            </div>
          )}

          {renderAnswerInput()}

          {validationSubmitError && !isAnswered && (
            <p className="text-sm text-destructive">{validationSubmitError}</p>
          )}

          {isAnswered && currentResult && (
            <Alert
              variant={currentResult.isCorrect ? "default" : "destructive"}
              className={
                currentResult.isCorrect
                  ? "border-green-500/50 bg-green-500/10"
                  : "border-destructive/50"
              }
            >
              {currentResult.isCorrect ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <div className="flex justify-between items-start">
                <div>
                  <AlertTitle
                    className={
                      currentResult.isCorrect
                        ? "text-green-400"
                        : "text-destructive"
                    }
                  >
                    {currentResult.isCorrect ? "Correct!" : "Incorrect"}
                    {" · "}
                    {typeof currentResult.score === "number"
                      ? currentResult.score
                      : 0}
                    %
                  </AlertTitle>
                  <AlertDescription>{currentResult.feedback}</AlertDescription>
                </div>
                {!currentResult.isCorrect && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAskAiDialogOpen(true)}
                  >
                    <HelpCircle className="mr-2 h-4 w-4" />
                    Ask AI
                  </Button>
                )}
              </div>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-2 justify-between">
          <div className="flex w-full sm:w-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="w-full sm:w-auto"
                  disabled={isLoading}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Quit Test
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Are you sure you want to quit?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Your progress for the completed questions will be saved and
                    you will be taken to the results screen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleQuit}>
                    Quit
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className="flex w-full sm:w-auto gap-2">
            {!isAnswered ? (
              <>
                <Button
                  onClick={handlePrevious}
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={isLoading || currentQuestionIndex === 0}
                >
                  Previous
                </Button>
                <Button
                  onClick={handleNextSkip}
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={
                    isLoading || (!isNextQuestionReady && !isTestFinished)
                  }
                >
                  Next
                </Button>
                <Button
                  ref={submitButtonRef}
                  onClick={handleAnswerSubmit}
                  disabled={isLoading || !userAnswer}
                  className="w-full sm:w-auto"
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isLoading ? validationSteps[loadingStep] : "Submit Answer"}
                </Button>
              </>
            ) : (
              <Button
                ref={nextButtonRef}
                onClick={handleNext}
                className="w-full sm:w-auto"
                disabled={isGenerating && !isNextQuestionReady}
              >
                {isGenerating && !isNextQuestionReady ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    <span>
                      {generationProgress
                        ? `Generating... (${generationProgress.current}/${generationProgress.total})`
                        : "Generating next question..."}
                    </span>
                  </>
                ) : isTestFinished ? (
                  "Finish Test"
                ) : (
                  "Next Question"
                )}
              </Button>
            )}
          </div>
        </CardFooter>
        <div className="px-6 pb-4 pt-3 border-t text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Keyboard:</span>{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted border border-border">Enter</kbd>{" "}
          submit ·{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted border border-border">Shift</kbd>+<kbd className="px-1 py-0.5 rounded bg-muted border border-border">Enter</kbd>{" "}
          or{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted border border-border">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded bg-muted border border-border">Enter</kbd>{" "}
          new line ·{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted border border-border">←</kbd>{" "}
          previous question ·{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted border border-border">→</kbd>{" "}
          next question ·{" "}
          <kbd className="px-1 py-0.5 rounded bg-muted border border-border">A</kbd>-
          <kbd className="px-1 py-0.5 rounded bg-muted border border-border">D</kbd>{" "}
          select MCQ
        </div>
      </Card>
    </div>
  );
}
