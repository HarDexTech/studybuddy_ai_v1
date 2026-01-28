"use client";

import { useState, useRef, useEffect } from "react";
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth";
import JSZip from "jszip";
import { generateBatchTestQuestions } from "@/ai/flows/generate-batch-test-questions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  UploadCloud,
  ListChecks,
  Baseline,
  MessageSquare,
  Loader2,
  CheckSquare,
  Timer,
  BrainCircuit,
  Brain,
  BrainCog,
  FileText,
  FileJson,
  FileType,
  History,
  AlertTriangle,
} from "lucide-react";
import type { TestSettings, Question, CachedDocument } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getRecentDocuments, addRecentDocument } from "@/lib/storage";

type UploadViewProps = {
  onDocumentUploaded: (
    documentText: string,
    file: { name: string; type: string; size: number },
  ) => void;
  onTestGenerated: (questions: Question[], settings: TestSettings) => void;
  existingDocument?: {
    text: string;
    file: { name: string; type: string; size: number };
  } | null;
};

const parsingSteps = [
  "Analyzing document...",
  "Extracting text...",
  "Almost ready...",
];

const INITIAL_BATCH_SIZE = 5;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 50;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const WARNING_THRESHOLD = 20;

function RecentDocuments({
  onSelect,
}: {
  onSelect: (doc: CachedDocument) => void;
}) {
  const [recentDocs, setRecentDocs] = useState<CachedDocument[]>([]);

  useEffect(() => {
    setRecentDocs(getRecentDocuments());
  }, []);

  if (recentDocs.length === 0) {
    return null;
  }

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <History className="w-5 h-5" /> Recent Documents
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {recentDocs.map((doc) => (
          <Card
            key={doc.id}
            className="hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => onSelect(doc)}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <FileText className="w-8 h-8 text-primary flex-shrink-0" />
              <div className="flex-grow overflow-hidden">
                <p className="font-semibold truncate">{doc.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatBytes(doc.size)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            Or upload a new file
          </span>
        </div>
      </div>
    </div>
  );
}

export function UploadView({
  onDocumentUploaded,
  onTestGenerated,
  existingDocument,
}: UploadViewProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(
    existingDocument?.file ? new File([], existingDocument.file.name) : null,
  );

  const [settings, setSettings] = useState<TestSettings>({
    questionType: "multiple choice",
    numberOfQuestions: 10,
    timerEnabled: false,
    timerDuration: 10,
    difficulty: "medium",
    questionSource: "strict",
  });

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTestCreationMode = !!existingDocument;

  // Question count validation
  const questionCountError =
    settings.numberOfQuestions < MIN_QUESTIONS
      ? `Minimum ${MIN_QUESTIONS} questions required`
      : settings.numberOfQuestions > MAX_QUESTIONS
        ? `Maximum ${MAX_QUESTIONS} questions allowed`
        : null;

  // Show warning for 20+ questions
  const showWarning = settings.numberOfQuestions >= WARNING_THRESHOLD;

  // Beforeunload warning when generating
  useEffect(() => {
    if (!isLoading || !isTestCreationMode) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Questions are being generated. Leave anyway?";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isLoading, isTestCreationMode]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isParsing) {
      interval = setInterval(() => {
        setLoadingMessage((prev) => {
          const currentIndex = parsingSteps.indexOf(prev);
          const nextIndex = (currentIndex + 1) % parsingSteps.length;
          return parsingSteps[nextIndex];
        });
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [isParsing]);

  const handleFileChange = async (selectedFile: File | null) => {
    if (!selectedFile) return;

    if (selectedFile.size > MAX_FILE_SIZE) {
      handleError(
        `File size exceeds the 50MB limit. Please upload a smaller document.`,
        "File Too Large",
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setLoadingMessage(parsingSteps[0]);

    const arrayBufferReader = new FileReader();
    arrayBufferReader.readAsArrayBuffer(selectedFile);

    try {
      const arrayBufferResult = await new Promise<ArrayBuffer>(
        (resolve, reject) => {
          arrayBufferReader.onload = (e) =>
            resolve(e.target?.result as ArrayBuffer);
          arrayBufferReader.onerror = reject;
        },
      );

      let text = "";
      if (selectedFile.type === "application/pdf") {
        pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const pdf = await pdfjs.getDocument({ data: arrayBufferResult })
          .promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text +=
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ") + "\n";
        }
      } else if (
        selectedFile.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const result = await mammoth.extractRawText({
          arrayBuffer: arrayBufferResult,
        });
        text = result.value;
      } else if (
        selectedFile.type ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      ) {
        const zip = await JSZip.loadAsync(arrayBufferResult);
        const slideTexts: string[] = [];
        const slidePromises: Promise<void>[] = [];

        zip.folder("ppt/slides")?.forEach((relativePath, file) => {
          if (relativePath.endsWith(".xml")) {
            const promise = file.async("string").then((xmlContent) => {
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(
                xmlContent,
                "application/xml",
              );
              const textNodes = xmlDoc.getElementsByTagName("a:t");
              let slideText = "";
              for (let i = 0; i < textNodes.length; i++) {
                slideText += textNodes[i].textContent + " ";
              }
              const slideNumMatch = relativePath.match(/slide(\d+)\.xml/);
              const slideNum = slideNumMatch
                ? parseInt(slideNumMatch[1], 10)
                : 999;
              slideTexts.push({ text: slideText.trim(), num: slideNum } as any);
            });
            slidePromises.push(promise);
          }
        });

        await Promise.all(slidePromises);

        text = (slideTexts as any[])
          .sort((a, b) => a.num - b.num)
          .map((s) => s.text)
          .join("\n\n");
      } else if (
        selectedFile.type === "text/plain" ||
        selectedFile.type.startsWith("text/")
      ) {
        text = new TextDecoder().decode(arrayBufferResult);
      } else {
        handleError(
          "Unsupported file type. Please use PDF, DOCX, PPTX, or a plain text file.",
        );
        return;
      }

      if (!text.trim()) {
        handleError(
          "Could not extract any text from the document. It might be empty or scanned as an image.",
          "No Text Found",
        );
        return;
      }

      const fileInfo = {
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size,
      };
      addRecentDocument({
        ...fileInfo,
        id: `${selectedFile.name}-${selectedFile.lastModified}`,
        lastModified: selectedFile.lastModified,
        text: text,
      });

      onDocumentUploaded(text, fileInfo);
    } catch (error) {
      console.error("Parsing error:", error);
      handleError("Failed to parse the document.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleSelectRecent = (doc: CachedDocument) => {
    onDocumentUploaded(doc.text, {
      name: doc.name,
      type: doc.type,
      size: doc.size,
    });
  };

  const handleError = (message: string, title: string = "Error") => {
    toast({ variant: "destructive", title: title, description: message });
    setIsLoading(false);
    setIsParsing(false);
    setGenerationProgress(0);
    if (title !== "AI Service Unavailable" && !isTestCreationMode) {
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleGenerateTest = async () => {
    if (!existingDocument) {
      toast({
        variant: "destructive",
        title: "No document context",
        description: "Something went wrong. Please upload the document again.",
      });
      return;
    }

    // Validate question count
    if (
      settings.numberOfQuestions < MIN_QUESTIONS ||
      settings.numberOfQuestions > MAX_QUESTIONS
    ) {
      toast({
        variant: "destructive",
        title: "Invalid Question Count",
        description:
          questionCountError || "Please enter a valid number of questions.",
      });
      return;
    }

    setIsLoading(true);
    setGenerationProgress(0);

    setLoadingMessage(`Generating initial ${INITIAL_BATCH_SIZE} questions...`);

    try {
      // Use BATCH generation for initial 5 questions
      const result = await generateBatchTestQuestions({
        documentContent: existingDocument.text,
        questionType: settings.questionType,
        difficulty: settings.difficulty,
        questionSource: settings.questionSource,
        existingQuestions: [],
        batchSize: INITIAL_BATCH_SIZE,
      });

      setGenerationProgress(100);

      // Check if we generated minimum required questions
      if (result.questions.length < MIN_QUESTIONS) {
        handleError(
          `Unable to generate minimum ${MIN_QUESTIONS} questions. Please try again or reduce document size.`,
          "Insufficient Questions Generated",
        );
        return;
      }

      // Success! Move to test view
      onTestGenerated(result.questions as Question[], settings);
    } catch (error) {
      console.error(error);
      const errorMessage =
        (error as Error)?.message || "An unknown error occurred.";
      const isRateLimitError = errorMessage.includes("429");
      const isServiceUnavailable =
        errorMessage.includes("503") ||
        errorMessage.toLowerCase().includes("overloaded");

      if (isRateLimitError) {
        handleError(
          "You've exceeded the free tier quota for the AI. Please wait a moment and try again, or upgrade your plan.",
          "AI Rate Limit Reached",
        );
      } else if (isServiceUnavailable) {
        handleError(
          "The AI model is temporarily overloaded. Please wait a moment and try generating the test again.",
          "AI Service Unavailable",
        );
      } else {
        handleError("An unexpected error occurred while generating the test.");
      }
    } finally {
      setIsLoading(false);
      setGenerationProgress(0);
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTestCreationMode) return;
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTestCreationMode) return;
    setIsDragging(false);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTestCreationMode) return;
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const getButtonText = () => {
    if (isLoading) return loadingMessage;
    if (isParsing) return loadingMessage;
    return "Generate Test";
  };

  if (isTestCreationMode) {
    return (
      <div className="w-full max-w-2xl mx-auto flex-grow flex items-center">
        <Card className="w-full animate-in fade-in-50 duration-500">
          <CardHeader>
            <CardTitle className="text-3xl font-bold text-center font-headline">
              Create Your Test
            </CardTitle>
            <CardDescription className="text-center">
              Adjust the settings for the test based on your document:{" "}
              <span className="font-semibold text-primary">
                {existingDocument.file.name}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Settings Form */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="question-type">Question Type</Label>
                <Select
                  value={settings.questionType}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      questionType: value as TestSettings["questionType"],
                    })
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger id="question-type" className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple choice">
                      <div className="flex items-center gap-2">
                        <ListChecks className="w-4 h-4" /> Multiple Choice
                      </div>
                    </SelectItem>
                    <SelectItem value="fill-in-the-blank">
                      <div className="flex items-center gap-2">
                        <Baseline className="w-4 h-4" /> Fill-in-the-Blank
                      </div>
                    </SelectItem>
                    <SelectItem value="theory">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" /> Open-Ended
                      </div>
                    </SelectItem>
                    <SelectItem value="true or false">
                      <div className="flex items-center gap-2">
                        <CheckSquare className="w-4 h-4" /> True or False
                      </div>
                    </SelectItem>
                    <SelectItem value="all">
                      <div className="flex items-center gap-2">
                        <FileType className="w-4 h-4" /> All Types
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="num-questions">
                  Number of Questions ({MIN_QUESTIONS}-{MAX_QUESTIONS})
                </Label>
                <Input
                  id="num-questions"
                  type="number"
                  value={settings.numberOfQuestions}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      numberOfQuestions: Math.min(
                        MAX_QUESTIONS,
                        Math.max(1, parseInt(e.target.value, 10) || 1),
                      ),
                    })
                  }
                  min={MIN_QUESTIONS}
                  max={MAX_QUESTIONS}
                  className={cn(
                    "w-full",
                    questionCountError &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                  disabled={isLoading}
                />
                {questionCountError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {questionCountError}
                  </p>
                )}
              </div>
            </div>

            {/* Warning for 20+ questions */}
            {showWarning && !questionCountError && (
              <Alert
                variant="destructive"
                className="border-orange-500/50 bg-orange-500/10"
              >
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <AlertTitle className="text-orange-600 dark:text-orange-400">
                  Large Test Warning
                </AlertTitle>
                <AlertDescription className="text-orange-600/90 dark:text-orange-400/90">
                  Tests with {WARNING_THRESHOLD}+ questions may take longer to
                  generate and could approach API rate limits. Consider breaking
                  into smaller tests for better performance.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="difficulty">Difficulty Level</Label>
                <Select
                  value={settings.difficulty}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      difficulty: value as TestSettings["difficulty"],
                    })
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger id="difficulty" className="w-full">
                    <SelectValue placeholder="Select difficulty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">
                      <div className="flex items-center gap-2">
                        <BrainCog className="w-4 h-4" /> Easy
                      </div>
                    </SelectItem>
                    <SelectItem value="medium">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4" /> Medium
                      </div>
                    </SelectItem>
                    <SelectItem value="hard">
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="w-4 h-4" /> Hard
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="question-source">Question Source</Label>
                <Select
                  value={settings.questionSource}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      questionSource: value as TestSettings["questionSource"],
                    })
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger id="question-source" className="w-full">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Strictly from Text
                      </div>
                    </SelectItem>
                    <SelectItem value="formed">
                      <div className="flex items-center gap-2">
                        <FileJson className="w-4 h-4" /> Formed from Concepts
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="timer-enabled"
                  checked={settings.timerEnabled}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, timerEnabled: checked })
                  }
                  disabled={isLoading}
                />
                <Label
                  htmlFor="timer-enabled"
                  className="flex items-center gap-2"
                >
                  <Timer className="w-4 h-4" /> Enable Timer
                </Label>
              </div>
              {settings.timerEnabled && (
                <div className="space-y-2 pl-8 animate-in fade-in-50 duration-300">
                  <Label htmlFor="timer-duration">
                    Timer Duration (minutes)
                  </Label>
                  <Input
                    id="timer-duration"
                    type="number"
                    value={settings.timerDuration}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        timerDuration: parseInt(e.target.value, 10) || 1,
                      })
                    }
                    min="1"
                    disabled={isLoading}
                  />
                </div>
              )}
            </div>

            {/* Generation Progress */}
            {isLoading && (
              <div className="space-y-3 animate-in fade-in-50 duration-300">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Generating initial questions...
                  </span>
                  <span className="font-semibold">{generationProgress}%</span>
                </div>
                <Progress value={generationProgress} className="h-2" />
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleGenerateTest}
              disabled={isLoading || !!questionCountError}
              className="w-full"
              size="lg"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {getButtonText()}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto flex-grow flex items-center">
      <Card className="w-full animate-in fade-in-50 duration-500">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center font-headline">
            Upload Your Document
          </CardTitle>
          <CardDescription className="text-center">
            Upload your study material to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecentDocuments onSelect={handleSelectRecent} />
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50",
            )}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              accept=".pdf,.docx,.pptx,.txt"
            />
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <UploadCloud className="h-10 w-10 text-primary" />
              {file && !isParsing ? (
                <p className="font-semibold text-foreground">{file.name}</p>
              ) : isParsing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="font-semibold text-foreground">
                    {loadingMessage}
                  </p>
                </div>
              ) : (
                <>
                  <p className="font-semibold text-foreground">
                    Drag & drop your file here
                  </p>
                  <p>or click to browse</p>
                  <p className="text-xs mt-2">
                    PDF, DOCX, PPTX, TXT supported (Max 50MB)
                  </p>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
