"use client";

import { useState, useRef, useEffect, type DragEvent } from "react";

// Module-level cache for past-question topic analysis
const topicAnalysisCache = new Map<string, { topics: string[]; seedQuestions: string[] }>();
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth";
import JSZip from "jszip";
import { generateSingleTestQuestion } from "@/ai/flows/generate-single-test-question";
import { generateCrossDocumentQuestions } from "@/ai/flows/generate-cross-document-questions";
import { extractTopicSection } from "@/ai/flows/extract-topic-section";
import { analyzePastQuestionTopics } from "@/ai/flows/analyze-past-question-topics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  addPastQuestionSet,
  addRecentDocument,
  clearAllRecentDocuments,
  getMultipleRecentDocuments,
  getRecentDocuments,
  getPastQuestionSets,
  removeRecentDocument,
  removePastQuestionSet,
} from "@/lib/storage";
import type {
  CachedDocument,
  Question,
  QuestionType,
  TestSettings,
} from "@/lib/types";
import { cn, pickRandomDocumentChunk } from "@/lib/utils";
import {
  AlertTriangle,
  Brain,
  BrainCircuit,
  BrainCog,
  FileJson,
  FileText,
  History,
  ListChecks,
  Loader2,
  Timer,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

type UploadViewProps = {
  onDocumentUploaded: (
    text: string,
    file: { name: string; type: string; size: number },
  ) => void;
  onTestGenerated: (
    questions: Question[],
    settings: TestSettings,
    effectiveDocumentText: string,
  ) => void;
  existingDocument?: {
    text: string;
    file: { name: string; type: string; size: number };
  } | null;
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 50;
const WARNING_THRESHOLD = 20;
const INITIAL_GENERATION_TIMEOUT = 30000;
const INITIAL_GENERATION_MAX_RETRIES = 1;
const OCR_TEXT_MIN_LENGTH = 800;
const OCR_TEXT_PER_PAGE_MIN = 120;
const OCR_PAGE_RENDER_SCALE = 2;

const AVAILABLE_QUESTION_TYPES: QuestionType[] = [
  "multiple choice",
  "fill-in-the-blank",
  "theory",
  "true or false",
];

const parsingSteps = [
  "Reading file...",
  "Extracting text...",
  "Cleaning up content...",
];

function RecentDocuments({
  onSelect,
}: {
  onSelect: (doc: CachedDocument) => void;
}) {
  const [recentDocs, setRecentDocs] = useState<CachedDocument[]>([]);
  const [showAll, setShowAll] = useState(false);

  const updateDocs = async () => {
    const docs = await getRecentDocuments();
    setRecentDocs(docs);
  };

  useEffect(() => {
    updateDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (recentDocs.length === 0) {
    return null;
  }

  const docsToRender = showAll ? recentDocs : recentDocs.slice(0, 5);

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
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <History className="w-5 h-5" /> Recent Documents
        </h3>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all recent documents?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove all saved documents. You will need to re-upload
                them to use them again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await clearAllRecentDocuments();
                  setShowAll(false);
                  await updateDocs();
                }}
              >
                Clear All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docsToRender.map((doc) => (
          <Card
            key={doc.id}
            className="group relative hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => onSelect(doc)}
          >
            <button
              type="button"
              aria-label={`Remove ${doc.name}`}
              className="absolute top-2 right-2 z-10 rounded-md p-1 text-muted-foreground opacity-40 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition"
              onClick={async (event) => {
                event.stopPropagation();
                await removeRecentDocument(doc.id);
                await updateDocs();
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
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

      {recentDocs.length > 5 && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((prev) => !prev)}
          >
            {showAll ? "Show Less" : `Show All (${recentDocs.length})`}
          </Button>
        </div>
      )}

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
    questionType: [...AVAILABLE_QUESTION_TYPES],
    numberOfQuestions: 10,
    timerEnabled: false,
    timerDuration: 10,
    difficulty: "medium",
    questionSource: "strict",
    topicFocus: "",
  });

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [parsingProgress, setParsingProgress] = useState<number | null>(null);
  const [manualText, setManualText] = useState("");
  const [crossDocEnabled, setCrossDocEnabled] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [recentDocs, setRecentDocs] = useState<CachedDocument[]>([]);
  const [pastQuestionSets, setPastQuestionSets] = useState<{ id: string; name: string }[]>([]);
  const [selectedPastQuestionSetIds, setSelectedPastQuestionSetIds] = useState<string[]>([]);
  const [isPastQuestionsMode, setIsPastQuestionsMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTestCreationMode = !!existingDocument;

  // Question count validation
  const questionCountError =
    settings.numberOfQuestions < MIN_QUESTIONS
      ? `Minimum ${MIN_QUESTIONS} questions required`
      : settings.numberOfQuestions > MAX_QUESTIONS
        ? `Maximum ${MAX_QUESTIONS} questions allowed`
        : null;
  const questionTypeError =
    settings.questionType.length === 0
      ? "Select at least one question type"
      : null;
  const questionTypeOptions: Array<{ value: QuestionType; label: string }> = [
    { value: "multiple choice", label: "Multiple Choice" },
    { value: "fill-in-the-blank", label: "Fill-in-the-Blank" },
    { value: "theory", label: "Open-Ended" },
    { value: "true or false", label: "True or False" },
  ];

  const selectedQuestionTypesLabel =
    settings.questionType.length === 0
      ? "Select question types"
      : settings.questionType.length === AVAILABLE_QUESTION_TYPES.length
        ? "All question types"
        : `${settings.questionType.length} selected`;

  // Show warning for 20+ questions
  const showWarning = settings.numberOfQuestions >= WARNING_THRESHOLD;

  // Load recent docs for cross-document mode and past question sets
  useEffect(() => {
    if (!isTestCreationMode) return;
    let cancelled = false;
    (async () => {
      const docs = await getRecentDocuments();
      const pqSets = await getPastQuestionSets();
      if (cancelled) return;
      setRecentDocs(
        docs.filter(
          (d) =>
            d.id !== existingDocument?.file.name &&
            d.text !== existingDocument?.text,
        ),
      );
      setPastQuestionSets(pqSets.map((s) => ({ id: s.id, name: s.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [isTestCreationMode, existingDocument]);

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
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isParsing) {
      interval = setInterval(() => {
        setLoadingMessage((prev) => {
          if (!parsingSteps.includes(prev)) {
            return prev;
          }

          const currentIndex = parsingSteps.indexOf(prev);
          const nextIndex = (currentIndex + 1) % parsingSteps.length;
          return parsingSteps[nextIndex];
        });
      }, 1500);
    }
    return () => {
      if (interval !== undefined) clearInterval(interval);
    };
  }, [isParsing]);

  const isLikelyScannedPdf = (text: string, pageCount: number) => {
    const normalizedLength = text.replace(/\s+/g, " ").trim().length;
    const perPageLength = normalizedLength / Math.max(pageCount, 1);

    return (
      normalizedLength < OCR_TEXT_MIN_LENGTH ||
      perPageLength < OCR_TEXT_PER_PAGE_MIN
    );
  };

  const extractNativePdfText = async (pdf: pdfjs.PDFDocumentProxy) => {
    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const progress = Math.round((i / Math.max(pdf.numPages, 1)) * 100);
      setParsingProgress(progress);
      setLoadingMessage(
        `Extracting text from page ${i}/${pdf.numPages} (${progress}%)...`,
      );
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text +=
        content.items.map((item) => ("str" in item ? item.str : "")).join(" ") +
        "\n";
    }

    return text;
  };

  const runPdfOcr = async (pdf: pdfjs.PDFDocumentProxy) => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    let ocrText = "";

    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const progress = Math.round((i / Math.max(pdf.numPages, 1)) * 100);
        setParsingProgress(progress);
        setLoadingMessage(
          `Running OCR on page ${i}/${pdf.numPages} (${progress}%)...`,
        );
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: OCR_PAGE_RENDER_SCALE });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Failed to initialize canvas for OCR.");
        }

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        await page.render({ canvasContext: context, viewport }).promise;

        const {
          data: { text },
        } = await worker.recognize(canvas);
        ocrText += `${text || ""}\n`;
      }
    } finally {
      await worker.terminate();
    }

    return ocrText;
  };

  useEffect(() => {
    if (isTestCreationMode) return;

    const handlePaste = async (event: ClipboardEvent) => {
      const activeElement = document.activeElement;
      const isTypingTarget =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        activeElement?.getAttribute("contenteditable") === "true";

      if (isTypingTarget) return;

      const items = event.clipboardData?.items;
      if (!items || items.length === 0) return;

      const clipboardItems = Array.from(items);
      const pdfItem = clipboardItems.find(
        (item) => item.kind === "file" && item.type === "application/pdf",
      );

      if (!pdfItem) {
        const hasOtherFile = clipboardItems.some(
          (item) => item.kind === "file",
        );
        if (hasOtherFile) {
          toast({
            variant: "destructive",
            title: "Paste Supports PDF Only",
            description:
              "Please paste a PDF document or upload another file type.",
          });
        }
        return;
      }

      const pastedFile = pdfItem.getAsFile();
      if (!pastedFile) return;

      event.preventDefault();

      const normalizedFile = new File(
        [pastedFile],
        pastedFile.name || `pasted-scan-${Date.now()}.pdf`,
        { type: "application/pdf" },
      );

      await handleFileChange(normalizedFile);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestCreationMode, toast]);

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
    setParsingProgress(0);
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

        setParsingProgress(0);
        setLoadingMessage("Detecting if PDF is scanned or selectable text...");
        const nativeText = await extractNativePdfText(pdf);

        if (isLikelyScannedPdf(nativeText, pdf.numPages)) {
          setLoadingMessage("Scanned PDF detected. Starting OCR...");
          const ocrText = await runPdfOcr(pdf);
          text = ocrText.trim() || nativeText;
        } else {
          text = nativeText;
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
        const slides: Array<{ text: string; num: number }> = [];
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
                const nodeText = textNodes[i].textContent;
                if (nodeText) slideText += nodeText + " ";
              }
              const slideNumMatch = relativePath.match(/slide(\d+)\.xml/);
              const slideNum = slideNumMatch
                ? parseInt(slideNumMatch[1], 10)
                : 999;
              slides.push({ text: slideText.trim(), num: slideNum });
            });
            slidePromises.push(promise);
          }
        });

        await Promise.all(slidePromises);

        text = slides
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

      if (isPastQuestionsMode) {
        const now = Date.now();
        await addPastQuestionSet({
          id: `pq-${selectedFile.name}-${selectedFile.lastModified}`,
          name: selectedFile.name,
          text,
          uploadedAt: now,
        });
        toast({
          title: "Past Questions Saved",
          description: `${selectedFile.name} saved as past exam questions.`,
        });
        setIsParsing(false);
        setParsingProgress(null);
        return;
      }

      addRecentDocument({
        ...fileInfo,
        id: `${selectedFile.name}-${selectedFile.lastModified}`,
        lastModified: selectedFile.lastModified,
        text: text,
      }).catch((err) => console.error("Failed to persist recent document:", err));

      onDocumentUploaded(text, fileInfo);
    } catch (error) {
      console.error("Parsing error:", error);
      handleError("Failed to parse the document.");
    } finally {
      setIsParsing(false);
      setParsingProgress(null);
    }
  };

  const handleSelectRecent = (doc: CachedDocument) => {
    onDocumentUploaded(doc.text, {
      name: doc.name,
      type: doc.type,
      size: doc.size,
    });
  };

  const handleUseManualText = () => {
    const trimmedText = manualText.trim();

    if (!trimmedText) {
      toast({
        variant: "destructive",
        title: "No Text Provided",
        description: "Please paste or type some text to continue.",
      });
      return;
    }

    const now = Date.now();
    const pastedDocumentName = `Pasted Text ${new Date(now).toLocaleString()}`;
    const pastedDocumentSize = new Blob([trimmedText]).size;

    if (isPastQuestionsMode) {
      addPastQuestionSet({
        id: `pq-pasted-text-${now}`,
        name: pastedDocumentName,
        text: trimmedText,
        uploadedAt: now,
      }).catch((err) => console.error("Failed to persist past question set:", err));
      toast({
        title: "Past Questions Saved",
        description: "Pasted text saved as past exam questions.",
      });
      setManualText("");
      return;
    }

    addRecentDocument({
      id: `pasted-text-${now}`,
      name: pastedDocumentName,
      type: "text/plain",
      size: pastedDocumentSize,
      lastModified: now,
      text: trimmedText,
    }).catch((err) => console.error("Failed to persist recent document:", err));

    onDocumentUploaded(trimmedText, {
      name: pastedDocumentName,
      type: "text/plain",
      size: pastedDocumentSize,
    });
  };

  const handleError = (message: string, title: string = "Error") => {
    toast({ variant: "destructive", title: title, description: message });
    setIsLoading(false);
    setIsParsing(false);
    setParsingProgress(null);
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

    if (settings.questionType.length === 0) {
      toast({
        variant: "destructive",
        title: "No Question Type Selected",
        description: "Select at least one question type to generate a test.",
      });
      return;
    }

    if (crossDocEnabled && selectedDocIds.length === 0) {
      toast({
        variant: "destructive",
        title: "No Additional Documents Selected",
        description: "Select at least one additional document for cross-document quizzing.",
      });
      return;
    }

    setIsLoading(true);

    setLoadingMessage("Generating first question...");

    try {
      let effectiveDocumentText = existingDocument.text;

      // Cross-document mode
      if (crossDocEnabled && selectedDocIds.length > 0) {
        const additionalDocs = await getMultipleRecentDocuments(selectedDocIds);
        const allDocs = [
          { name: existingDocument.file.name, content: existingDocument.text },
          ...additionalDocs.map((d) => ({ name: d.name, content: d.text })),
        ];

        // Build combined effective text with doc markers
        effectiveDocumentText = allDocs
          .map((d, i) => `--- DOCUMENT ${i + 1}: ${d.name} ---\n${d.content}`)
          .join('\n\n');

        setLoadingMessage("Generating cross-document questions...");
        const result = await generateCrossDocumentQuestions({
          documents: allDocs,
          questionTypes: settings.questionType,
          difficulty: settings.difficulty,
          questionSource: settings.questionSource,
          numberOfQuestions: Math.min(settings.numberOfQuestions, 10),
          existingQuestions: [],
        });

        if (!result.questions || result.questions.length === 0) {
          throw new Error("Failed to generate cross-document questions.");
        }

        onTestGenerated(result.questions as Question[], settings, effectiveDocumentText);
        return;
      }

      let prioritizedTopics: string[] | undefined;
      let seedQ: string[] | undefined;

      if (settings.pastQuestionSetIds && settings.pastQuestionSetIds.length > 0) {
        const cacheKey = `${existingDocument.text.length}:${existingDocument.text.slice(0, 120)}|${settings.pastQuestionSetIds.sort().join(",")}`;

        const cached = topicAnalysisCache.get(cacheKey);
        if (cached) {
          prioritizedTopics = cached.topics;
          seedQ = settings.reusePastQuestions ? cached.seedQuestions : undefined;
        } else {
          setLoadingMessage("Analyzing past questions against document...");
          try {
            const pqSets = await (await import("@/lib/storage")).getMultiplePastQuestionSets(settings.pastQuestionSetIds);
            const combinedPastText = pqSets.map((s) => `--- ${s.name} ---\n${s.text}`).join('\n\n');
            const analysis = await analyzePastQuestionTopics({
              documents: [{ name: existingDocument.file.name, content: existingDocument.text }],
              pastQuestionsText: combinedPastText,
            });
            prioritizedTopics = analysis.topics.map((t) => t.topic);
            seedQ = settings.reusePastQuestions ? analysis.matchingQuestions : undefined;
            topicAnalysisCache.set(cacheKey, {
              topics: prioritizedTopics,
              seedQuestions: seedQ ?? [],
            });
          } catch (err) {
            console.warn("Past-question analysis failed, continuing without topic bias:", err);
          }
        }
      }

      if (settings.topicFocus?.trim()) {
        setLoadingMessage("Finding relevant section...");
        const extracted = await extractTopicSection({
          documentContent: existingDocument.text,
          topicFocus: settings.topicFocus.trim(),
        });

        effectiveDocumentText =
          extracted.extractedText?.trim() || existingDocument.text;
      }

      let firstQuestion: Question | null = null;
      let attempt = 0;

      while (attempt <= INITIAL_GENERATION_MAX_RETRIES && !firstQuestion) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Generation timeout")),
              INITIAL_GENERATION_TIMEOUT,
            ),
          );

          const generationPromise = generateSingleTestQuestion({
            documentContent: pickRandomDocumentChunk(effectiveDocumentText),
            questionTypes: settings.questionType,
            difficulty: settings.difficulty,
            questionSource: settings.questionSource,
            existingQuestions: [],
          });

          firstQuestion = (await Promise.race([
            generationPromise,
            timeoutPromise,
          ])) as Question;
        } catch (error) {
          const errorMessage = ((error as Error)?.message || "").toLowerCase();
          const isRetryable =
            errorMessage.includes("timeout") ||
            errorMessage.includes("fetch") ||
            errorMessage.includes("network") ||
            errorMessage.includes("503") ||
            errorMessage.includes("overloaded");

          if (!isRetryable || attempt >= INITIAL_GENERATION_MAX_RETRIES) {
            throw error;
          }

          attempt++;
          toast({
            variant: "destructive",
            title: "Generation Failed",
            description: `Retrying... (${attempt}/${INITIAL_GENERATION_MAX_RETRIES})`,
          });
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!firstQuestion) {
        throw new Error("Failed to generate first question.");
      }

      onTestGenerated([firstQuestion], {
        ...settings,
        priorityTopics: prioritizedTopics,
        seedQuestions: seedQ,
      }, effectiveDocumentText);
    } catch (error) {
      const errorMessage =
        (error as Error)?.message || "An unknown error occurred.";
      const errorText = errorMessage.toLowerCase();
      const isTemporaryUnavailable = errorMessage.includes(
        "AI_TEMP_UNAVAILABLE",
      );
      const isRateLimitError = errorMessage.includes("429");
      const isServiceUnavailable =
        errorMessage.includes("503") || errorText.includes("overloaded");
      const isNetworkFailure =
        errorText.includes("failed to fetch") ||
        errorText.includes("fetch") ||
        errorText.includes("network") ||
        errorText.includes("econnreset") ||
        errorText.includes("etimedout") ||
        errorText.includes("enotfound");

      if (isRateLimitError) {
        handleError(
          "You've exceeded the free tier quota for the AI. Please wait a moment and try again, or upgrade your plan.",
          "AI Rate Limit Reached",
        );
      } else if (
        isTemporaryUnavailable ||
        isServiceUnavailable ||
        isNetworkFailure
      ) {
        handleError(
          "The AI service is temporarily unavailable. Please check your connection and try again.",
          "AI Service Unavailable",
        );
      } else {
        handleError("An unexpected error occurred while generating the test.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTestCreationMode) return;
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTestCreationMode) return;
    setIsDragging(false);
  };
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
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

  const toggleQuestionType = (value: QuestionType, checked: boolean) => {
    setSettings((prev) => {
      const nextTypes = checked
        ? Array.from(new Set([...prev.questionType, value]))
        : prev.questionType.filter((type) => type !== value);

      return {
        ...prev,
        questionType: AVAILABLE_QUESTION_TYPES.filter((type) =>
          nextTypes.includes(type),
        ),
      };
    });
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id="question-type"
                      type="button"
                      variant="outline"
                      className={cn(
                        "w-full justify-between",
                        questionTypeError && "border-destructive",
                      )}
                      disabled={isLoading}
                    >
                      <span>{selectedQuestionTypesLabel}</span>
                      <ListChecks className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-[--radix-dropdown-menu-trigger-width]"
                  >
                    {questionTypeOptions.map((typeOption) => (
                      <DropdownMenuCheckboxItem
                        key={typeOption.value}
                        checked={settings.questionType.includes(
                          typeOption.value,
                        )}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) =>
                          toggleQuestionType(typeOption.value, Boolean(checked))
                        }
                      >
                        {typeOption.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {questionTypeError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {questionTypeError}
                  </p>
                )}
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

            <div className="space-y-2">
              <Label htmlFor="topic-focus">
                Chapter / Topic Focus (optional)
              </Label>
              <Input
                id="topic-focus"
                type="text"
                placeholder="e.g. Chapter 3, Photosynthesis, Unit 2..."
                value={settings.topicFocus || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    topicFocus: e.target.value,
                  })
                }
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the entire document.
              </p>
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

            {/* Cross-Document Section */}
            <div className="space-y-4 pt-2 border-t">
              <div className="flex items-center space-x-2">
                <Switch
                  id="cross-doc-enabled"
                  checked={crossDocEnabled}
                  onCheckedChange={(checked) => {
                    setCrossDocEnabled(checked);
                    if (!checked) setSelectedDocIds([]);
                  }}
                  disabled={isLoading || recentDocs.length === 0}
                />
                <Label
                  htmlFor="cross-doc-enabled"
                  className="flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" /> Cross-Document Quizzing
                </Label>
              </div>
              {crossDocEnabled && (
                <div className="pl-8 space-y-3 animate-in fade-in-50 duration-300">
                  <p className="text-xs text-muted-foreground">
                    Select additional documents to generate questions that span
                    multiple sources.
                  </p>
                  {recentDocs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No other recent documents available. Upload more documents
                      first.
                    </p>
                  ) : (
                    <ScrollArea className="max-h-48 rounded-md border p-2">
                      <div className="space-y-1">
                        {recentDocs.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                            onClick={() => {
                              setSelectedDocIds((prev) =>
                                prev.includes(doc.id)
                                  ? prev.filter((id) => id !== doc.id)
                                  : [...prev, doc.id],
                              );
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDocIds.includes(doc.id)}
                              onChange={() => {}}
                              className="h-4 w-4"
                            />
                            <div className="flex-grow min-w-0">
                              <p className="text-sm truncate">{doc.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(doc.size / 1024).toFixed(0)} KB
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  {selectedDocIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedDocIds.length + 1} document
                      {(selectedDocIds.length + 1) > 1 ? "s" : ""} selected
                      (including current)
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Past Questions Section */}
            <div className="space-y-4 pt-2 border-t">
              <div className="flex items-center space-x-2">
                <Switch
                  id="past-questions-enabled"
                  checked={selectedPastQuestionSetIds.length > 0}
                  onCheckedChange={(checked) => {
                    if (!checked) {
                      setSelectedPastQuestionSetIds([]);
                      setSettings((prev) => ({
                        ...prev,
                        pastQuestionSetIds: undefined,
                        prioritizeExamTopics: false,
                        reusePastQuestions: false,
                      }));
                    }
                  }}
                  disabled={isLoading || pastQuestionSets.length === 0}
                />
                <Label
                  htmlFor="past-questions-enabled"
                  className="flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" /> Past Exam Questions
                </Label>
              </div>
              {selectedPastQuestionSetIds.length > 0 ? (
                <div className="pl-8 space-y-3 animate-in fade-in-50 duration-300">
                  <p className="text-xs text-muted-foreground">
                    Past questions are analyzed to identify frequently tested
                    topics for prioritized study.
                  </p>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="prioritize-topics"
                      checked={settings.prioritizeExamTopics ?? true}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({
                          ...prev,
                          prioritizeExamTopics: checked,
                        }))
                      }
                      disabled={isLoading}
                    />
                    <Label htmlFor="prioritize-topics" className="text-sm">
                      Prioritize topics from past questions
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="reuse-past-questions"
                      checked={settings.reusePastQuestions ?? false}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({
                          ...prev,
                          reusePastQuestions: checked,
                        }))
                      }
                      disabled={isLoading}
                    />
                    <Label htmlFor="reuse-past-questions" className="text-sm">
                      Reuse past questions verbatim
                    </Label>
                  </div>
                  {pastQuestionSets.length > 0 && (
                    <ScrollArea className="max-h-36 rounded-md border p-2">
                      <div className="space-y-1">
                        {pastQuestionSets.map((pq) => (
                          <div
                            key={pq.id}
                            className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                            onClick={() => {
                              const newIds = selectedPastQuestionSetIds.includes(pq.id)
                                ? selectedPastQuestionSetIds.filter((id) => id !== pq.id)
                                : [...selectedPastQuestionSetIds, pq.id];
                              setSelectedPastQuestionSetIds(newIds);
                              setSettings((prev) => ({
                                ...prev,
                                pastQuestionSetIds: newIds.length > 0 ? newIds : undefined,
                              }));
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedPastQuestionSetIds.includes(pq.id)}
                              onChange={() => {}}
                              className="h-4 w-4"
                            />
                            <p className="text-sm truncate">{pq.name}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              ) : pastQuestionSets.length > 0 ? (
                <div className="pl-8">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedPastQuestionSetIds(
                        pastQuestionSets.map((s) => s.id),
                      );
                      setSettings((prev) => ({
                        ...prev,
                        pastQuestionSetIds: pastQuestionSets.map((s) => s.id),
                        prioritizeExamTopics: true,
                      }));
                    }}
                    disabled={isLoading}
                  >
                    Select Past Questions to Analyze
                  </Button>
                </div>
              ) : (
                <div className="pl-8">
                  <p className="text-xs text-muted-foreground">
                    No past questions uploaded yet. Upload past exam papers in
                    the document upload step.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleGenerateTest}
              disabled={
                isLoading || !!questionCountError || !!questionTypeError
              }
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
                  {parsingProgress !== null && (
                    <div className="w-full max-w-xs space-y-1">
                      <Progress value={parsingProgress} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        {parsingProgress}%
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <p className="font-semibold text-foreground">
                    Drag & drop your file here
                  </p>
                  <p>or click to browse</p>
                  <p className="text-xs">or paste a PDF from clipboard</p>
                  <p className="text-xs mt-2">
                    PDF, DOCX, PPTX, TXT supported (Max 50MB)
                  </p>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Scanned PDFs are supported with OCR and may take longer to process.
          </p>

          <div className="flex items-center space-x-2 mt-4">
            <Switch
              id="past-questions-upload-mode"
              checked={isPastQuestionsMode}
              onCheckedChange={setIsPastQuestionsMode}
              disabled={isParsing}
            />
            <Label htmlFor="past-questions-upload-mode" className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4" /> Upload as past exam questions
            </Label>
          </div>
          {isPastQuestionsMode && (
            <p className="text-xs text-muted-foreground mt-1 ml-9">
              Past questions will be saved separately and can be used to bias test generation toward frequently tested topics.
            </p>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or paste text
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <Label htmlFor="manual-text-input">Paste your study text</Label>
            <Textarea
              id="manual-text-input"
              placeholder="Paste or type your study material here..."
              rows={8}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              disabled={isParsing}
            />
            <Button
              type="button"
              onClick={handleUseManualText}
              disabled={isParsing || !manualText.trim()}
              className="w-full"
            >
              Use This Text
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
