'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { generateSingleTestQuestion } from '@/ai/flows/generate-single-test-question';
import { validateUserAnswer, type ValidateUserAnswerOutput } from '@/ai/flows/validate-user-answer';
import { explainQuestion } from '@/ai/flows/explain-question';
import type { TestResult, TestSettings, Question, MultipleChoiceQuestion, TrueFalseQuestion } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
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
} from "@/components/ui/alert-dialog"
import { Loader2, CheckCircle2, XCircle, Timer, Hourglass, LogOut, Sparkles, HelpCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type TestViewProps = {
    initialQuestions: Question[];
    documentInfo: { text: string };
    settings: TestSettings;
    onTestFinished: (results: TestResult[]) => void;
};

const validationSteps = [
    'Analyzing your answer...',
    'Comparing with the document...',
    'Finalizing feedback...',
];

// Fisher-Yates shuffle algorithm
const shuffleArray = <T>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

function AskAiDialog({ open, onOpenChange, documentText, question, onTimerPause, onTimerResume }: { open: boolean, onOpenChange: (open: boolean) => void, documentText: string, question: Question, onTimerPause: () => void, onTimerResume: () => void }) {
    const [isLoading, setIsLoading] = useState(false);
    const [explanation, setExplanation] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (open) {
            onTimerPause();
            handleAskAi();
        } else {
            onTimerResume();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleAskAi = async () => {
        setIsLoading(true);
        setExplanation(null);
        try {
            const correctAnswer = 'correctAnswer' in question ? String(question.correctAnswer) : 'N/A for this question type';

            const result = await explainQuestion({
                documentContent: documentText,
                question: question.question,
                correctAnswer: correctAnswer,
            });
            setExplanation(result.explanation);
        } catch (error) {
            console.error('Ask AI Error:', error);
            const errorMessage = (error as Error)?.message || 'An unknown error occurred.';
             toast({
                variant: 'destructive',
                title: 'Error Getting Explanation',
                description: errorMessage,
            });
            onOpenChange(false); // Close dialog on error
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


export function TestView({ initialQuestions, documentInfo, settings, onTestFinished }: TestViewProps) {
    const { toast, dismiss } = useToast();
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [userAnswer, setUserAnswer] = useState('');
    const [results, setResults] = useState<TestResult[]>([]);
    const [currentResult, setCurrentResult] = useState<ValidateUserAnswerOutput | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [loadingStep, setLoadingStep] = useState(0);
    const [isAnswered, setIsAnswered] = useState(false);
    
    const [isTimerPaused, setIsTimerPaused] = useState(false);
    const [timeLeft, setTimeLeft] = useState<number | null>(settings.timerEnabled && settings.timerDuration ? settings.timerDuration * 60 : null);
    
    const [questions, setQuestions] = useState<Question[]>(() => shuffleArray(initialQuestions));
    const backgroundGenerationStarted = useRef(false);
    const generationErrorToastId = useRef<string | null>(null);
    const [isAskAiDialogOpen, setIsAskAiDialogOpen] = useState(false);

    const totalQuestionsToGenerate = settings.numberOfQuestions;
    const currentQuestion = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex) / totalQuestionsToGenerate) * 100;
    
    const nextButtonRef = useRef<HTMLButtonElement>(null);
    const submitButtonRef = useRef<HTMLButtonElement>(null);
    
    const timerCallback = useRef<() => void>();

    const finishTest = useCallback((finalResults: TestResult[]) => {
        onTestFinished(finalResults);
    }, [onTestFinished]);

    // This effect contains the logic for a single timer tick.
    useEffect(() => {
        timerCallback.current = () => {
            if (isLoading || isGenerating || isTimerPaused) {
                return;
            }
    
            setTimeLeft(prev => {
                if (prev === null) return null;
                if (prev > 1) {
                    return prev - 1;
                }

                // Timer is at 1, about to hit 0. Finish the test.
                let finalResults = [...results];
                const answeredQuestions = new Set(finalResults.map(r => r.question.question));

                if (currentQuestion && !answeredQuestions.has(currentQuestion.question)) {
                    finalResults.push({
                        question: currentQuestion,
                        userAnswer: '',
                        isCorrect: false,
                        feedback: "Time ran out and this question was skipped.",
                    });
                    answeredQuestions.add(currentQuestion.question);
                }

                questions.forEach(q => {
                    if (!answeredQuestions.has(q.question)) {
                        finalResults.push({
                            question: q,
                            userAnswer: '',
                            isCorrect: false,
                            feedback: "Time ran out before reaching this question.",
                        });
                    }
                });
                
                finishTest(finalResults);
                return 0;
            });
        };
    });

    // This effect sets up and tears down the interval.
    useEffect(() => {
        if (!settings.timerEnabled) {
            return;
        }

        const intervalId = setInterval(() => {
            timerCallback.current?.();
        }, 1000);

        return () => clearInterval(intervalId);
    }, [settings.timerEnabled, finishTest]);

    
    // Background question generation
    useEffect(() => {
        const generateRemainingQuestions = async () => {
            if (backgroundGenerationStarted.current || questions.length >= totalQuestionsToGenerate) {
                return;
            }
            backgroundGenerationStarted.current = true;
            
            let currentGeneratedQuestions = [...questions];

            for (let i = currentGeneratedQuestions.length; i < totalQuestionsToGenerate; i++) {
                while (isLoading) { // Pause generation if validation is in progress
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                setIsGenerating(true);
                try {
                    const result = await generateSingleTestQuestion({
                        documentContent: documentInfo.text,
                        questionType: settings.questionType,
                        difficulty: settings.difficulty,
                        questionSource: settings.questionSource,
                        existingQuestions: currentGeneratedQuestions.map(q => q.question),
                    });
                    
                    if (generationErrorToastId.current) {
                        dismiss(generationErrorToastId.current);
                        generationErrorToastId.current = null;
                    }
                    currentGeneratedQuestions.push(result as Question);
                    // Do not shuffle here to avoid re-ordering answered questions
                    setQuestions([...currentGeneratedQuestions]);
                    
                } catch (error) {
                    console.error('Failed to generate a background question:', error);
                    const errorMessage = (error as Error)?.message || 'An unknown error occurred.';
                    const isRateLimitError = errorMessage.includes('429');
                    const isServiceUnavailable = errorMessage.includes('503') || errorMessage.toLowerCase().includes('overloaded');

                    if (isRateLimitError) {
                        toast({
                            variant: 'destructive',
                            title: 'AI Rate Limit Reached',
                            description: "You've exceeded the free tier quota. No more questions can be generated at this time.",
                        });
                        // Stop trying to generate more questions
                        break;
                    } else if (isServiceUnavailable) {
                        if (!generationErrorToastId.current) {
                           const { id } = toast({
                                variant: 'destructive',
                                title: 'AI Service Temporarily Unavailable',
                                description: "The AI is overloaded. We'll keep trying to generate the next question in the background.",
                            });
                            generationErrorToastId.current = id;
                        }
                        // Retry after a delay
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        i--; // Decrement to retry the same question index
                    } else {
                        // For other errors, maybe stop or show a different message
                        toast({
                            variant: 'destructive',
                            title: 'Question Generation Failed',
                            description: "There was an error generating a new question. The test may not have the full number of questions.",
                        });
                        // Stop trying to generate more questions
                        break;
                    }
                } finally {
                    setIsGenerating(false);
                }
            }
             if (generationErrorToastId.current) {
                dismiss(generationErrorToastId.current);
                generationErrorToastId.current = null;
            }
        };

        generateRemainingQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading]); // Rerun when loading state changes


    useEffect(() => {
        setUserAnswer('');
        setCurrentResult(null);
        setIsAnswered(false);
    }, [currentQuestionIndex]);
    
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isLoading) {
            interval = setInterval(() => {
                setLoadingStep(prev => (prev + 1) % validationSteps.length);
            }, 2000);
        }
        return () => clearInterval(interval);
    }, [isLoading]);

    const handleAnswerSubmit = async () => {
        if (!userAnswer && (currentQuestion.type === 'multiple choice' || currentQuestion.type === 'true or false')) {
            toast({
                variant: 'destructive',
                title: 'No Answer Selected',
                description: 'Please select an option before submitting.',
            });
            return;
        }
        if (isLoading || isAnswered) return;
        
        setIsLoading(true);
        setLoadingStep(0);
        
        try {
             let validationResult: ValidateUserAnswerOutput;

             if(currentQuestion.type === 'multiple choice') {
                const isCorrect = userAnswer === (currentQuestion as MultipleChoiceQuestion).correctAnswer;
                const feedback = isCorrect 
                    ? "Correct!" 
                    : `Incorrect. The correct answer is ${(currentQuestion as MultipleChoiceQuestion).correctAnswer}.`;
                validationResult = { isCorrect, feedback };
             } else if (currentQuestion.type === 'true or false') {
                const isCorrect = userAnswer === String((currentQuestion as TrueFalseQuestion).correctAnswer);
                const feedback = isCorrect
                    ? "Correct!" 
                    : `Incorrect. The correct answer is ${String((currentQuestion as TrueFalseQuestion).correctAnswer)}.`;
                validationResult = { isCorrect, feedback };
             } else {
                // FIXED: Removed questionType and questionSource parameters
                validationResult = await validateUserAnswer({
                    documentContent: documentInfo.text,
                    question: currentQuestion.question,
                    userAnswer: userAnswer,
                    correctAnswer: 'correctAnswer' in currentQuestion ? String(currentQuestion.correctAnswer) : '',
                });
             }
            
            setCurrentResult(validationResult);
            setResults(prev => [...prev, { question: currentQuestion, userAnswer: userAnswer, ...validationResult }]);
            setIsAnswered(true);
        } catch (error) {
            console.error(error);
            const errorMessage = (error as Error)?.message || 'An unknown error occurred.';
            const isServiceUnavailable = errorMessage.includes('503') || errorMessage.toLowerCase().includes('overloaded');

            toast({
                variant: 'destructive',
                title: isServiceUnavailable ? 'AI Service Unavailable' : 'Validation Error',
                description: isServiceUnavailable ? 'The AI model is currently overloaded. Your answer could not be validated.' : "An error occurred while validating your answer.",
            });
            
            const errorResult = {
                question: currentQuestion,
                userAnswer: userAnswer,
                isCorrect: false,
                feedback: isServiceUnavailable ? "Couldn't validate the answer due to an AI service error. The model is overloaded." : "Couldn't validate the answer due to an unexpected error."
            };
            setCurrentResult({isCorrect: errorResult.isCorrect, feedback: errorResult.feedback});
            setResults(prev => [...prev, errorResult]);
            setIsAnswered(true);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSkip = () => {
        const skippedResult = {
            question: currentQuestion,
            userAnswer: '',
            isCorrect: false,
            feedback: "This question was skipped.",
        };
        setResults(prev => [...prev, skippedResult]);
        
        if (currentQuestionIndex < totalQuestionsToGenerate - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        } else {
            finishTest([...results, skippedResult]);
        }
    };

    const handleNext = () => {
        if (currentQuestionIndex < totalQuestionsToGenerate - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        } else {
            finishTest(results);
        }
    };
    
    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.target instanceof HTMLTextAreaElement && event.key === 'Enter' && !event.shiftKey) {
                return;
            }

            if (isAnswered) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    nextButtonRef.current?.click();
                }
                return;
            }

            if (isLoading) return;

            const isMcqOrTf = currentQuestion.type === 'multiple choice' || currentQuestion.type === 'true or false';
            const isText = currentQuestion.type === 'fill-in-the-blank' || currentQuestion.type === 'theory';

            if (isMcqOrTf && event.key === 'Enter') {
                 event.preventDefault();
                 submitButtonRef.current?.click();
            } else if (isText && event.key === 'Enter' && (event.metaKey || event.ctrlKey || event.shiftKey)) {
                 event.preventDefault();
                 submitButtonRef.current?.click();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isAnswered, isLoading, currentQuestion.type]);


    const handleQuit = () => {
        finishTest(results);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    const renderAnswerInput = () => {
        switch (currentQuestion.type) {
            case 'multiple choice':
                const mcq = currentQuestion as MultipleChoiceQuestion;
                return (
                    <RadioGroup value={userAnswer} onValueChange={setUserAnswer} disabled={isAnswered || isLoading} className="space-y-2">
                        {mcq.choices.map((choice, index) => (
                            <div key={index} className="flex items-center space-x-3 p-3 rounded-md border border-input has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                <RadioGroupItem value={choice} id={`choice-${index}`} />
                                <Label htmlFor={`choice-${index}`} className="flex-1 cursor-pointer">{choice}</Label>
                            </div>
                        ))}
                    </RadioGroup>
                );
            case 'true or false':
                 return (
                    <div className="flex flex-col sm:flex-row gap-4">
                        <Button
                            variant={userAnswer === 'true' ? 'default' : 'outline'}
                            onClick={() => setUserAnswer('true')}
                            disabled={isAnswered || isLoading}
                            className="flex-1 h-12 text-lg"
                        >
                            True
                        </Button>
                        <Button
                             variant={userAnswer === 'false' ? 'default' : 'outline'}
                             onClick={() => setUserAnswer('false')}
                             disabled={isAnswered || isLoading}
                             className="flex-1 h-12 text-lg"
                        >
                            False
                        </Button>
                    </div>
                );
            case 'fill-in-the-blank':
            case 'theory':
            default:
                return (
                    <Textarea
                        placeholder="Your answer here... (Shift+Enter or Ctrl+Enter to submit)"
                        value={userAnswer}
                        onChange={(e) => setUserAnswer(e.target.value)}
                        rows={5}
                        disabled={isAnswered || isLoading}
                    />
                );
        }
    };
    
    const questionsAvailable = questions.length;
    const isNextQuestionReady = questions.length > currentQuestionIndex + 1;
    const isTestFinished = currentQuestionIndex >= totalQuestionsToGenerate - 1;


    return (
        <div className="w-full max-w-3xl mx-auto flex-grow flex flex-col justify-center space-y-4">
            {currentQuestion && (
                 <AskAiDialog 
                    open={isAskAiDialogOpen}
                    onOpenChange={setIsAskAiDialogOpen}
                    documentText={documentInfo.text}
                    question={currentQuestion}
                    onTimerPause={() => setIsTimerPaused(true)}
                    onTimerResume={() => setIsTimerPaused(false)}
                 />
            )}

            <div className="flex justify-between items-center gap-4">
                 <div className="flex-1">
                    <Progress value={progress} className="w-full h-4" />
                 </div>
                 <div className="flex items-center gap-4">
                    {timeLeft !== null && (
                        <div className="flex items-center gap-2 text-lg font-semibold text-primary shrink-0">
                            {isLoading || isGenerating || isTimerPaused ? <Hourglass className="h-5 w-5 animate-spin" /> : <Timer className="h-5 w-5" />}
                            <span>{formatTime(timeLeft)}</span>
                        </div>
                    )}
                 </div>
            </div>
            <Card className="w-full animate-in fade-in-50 duration-500" key={currentQuestionIndex}>
                <CardHeader>
                    <div className='flex justify-between items-center'>
                      <CardTitle className="text-2xl font-headline">
                          Question {currentQuestionIndex + 1} of {totalQuestionsToGenerate}
                      </CardTitle>
                      {questionsAvailable < totalQuestionsToGenerate && <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Generating questions... ({questionsAvailable}/{totalQuestionsToGenerate})</span>
                      </div>}
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <p className="text-lg font-medium">{currentQuestion.question}</p>
                    
                    {renderAnswerInput()}
                    
                    {isAnswered && currentResult && (
                         <Alert variant={currentResult.isCorrect ? 'default' : 'destructive'} className={currentResult.isCorrect ? 'border-green-500/50 bg-green-500/10' : 'border-destructive/50'}>
                            {currentResult.isCorrect ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                                <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <div className="flex justify-between items-start">
                                <div>
                                    <AlertTitle className={currentResult.isCorrect ? 'text-green-400' : 'text-destructive'}>
                                        {currentResult.isCorrect ? 'Correct!' : 'Incorrect'}
                                    </AlertTitle>
                                    <AlertDescription>
                                        {currentResult.feedback}
                                    </AlertDescription>
                                </div>
                                {!currentResult.isCorrect && (
                                     <Button variant="ghost" size="sm" onClick={() => setIsAskAiDialogOpen(true)}>
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
                                <Button variant="destructive" className="w-full sm:w-auto" disabled={isLoading}>
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Quit Test
                                </Button>

                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure you want to quit?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Your progress for the completed questions will be saved and you will be taken to the results screen.
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleQuit}>Quit</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                    <div className="flex w-full sm:w-auto gap-2">
                        {!isAnswered ? (
                            <>
                              <Button onClick={handleSkip} variant="outline" className="w-full sm:w-auto" disabled={isLoading}>
                                Skip
                              </Button>
                              <Button ref={submitButtonRef} onClick={handleAnswerSubmit} disabled={isLoading || !userAnswer} className="w-full sm:w-auto">
                                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  {isLoading ? validationSteps[loadingStep] : 'Submit Answer'}
                              </Button>
                            </>
                        ) : (
                            <Button ref={nextButtonRef} onClick={handleNext} className="w-full sm:w-auto" disabled={isGenerating && !isNextQuestionReady}>
                                 {isGenerating && !isNextQuestionReady ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        <span>Preparing next question...</span>
                                    </>
                                 ) : isTestFinished ? 'Finish Test' : 'Next Question'
                                 }
                            </Button>
                        )}
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
}