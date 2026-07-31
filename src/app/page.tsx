"use client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { useEffect, useState } from "react";
import { Header } from "@/components/app/header";
import { UploadView } from "@/components/app/upload-view";
import { StudyView } from "@/components/app/study-view";
import { TestView } from "@/components/app/test-view";
import { ResultsView } from "@/components/app/results-view";
import { SummaryView } from "@/components/app/summary-view";
import { Toaster } from "@/components/ui/toaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { loadTestProgress, clearTestProgress } from "@/lib/storage";
import type { StoredTestProgress, TestResult, TestSettings, Question } from "@/lib/types";

// The shape of restored progress we use in this component — narrows the
// generic StoredTestProgress type from storage.ts to typed Question/TestSettings.
type RestoredTestProgress = {
  docSignature?: string;
  settingsSignature?: string;
  questions?: Question[];
  settings?: TestSettings;
  documentInfo?: {
    text: string;
    file?: { name: string; type: string; size: number };
  };
  effectiveDocumentText?: string;
  currentQuestionIndex?: number;
  userAnswer?: string;
  results?: TestResult[];
  currentResult?: {
    isCorrect: boolean;
    feedback: string;
  } | null;
  isAnswered?: boolean;
  timeLeft?: number | null;
  generatedQuestionCount?: number;
};

type TestRestoreSnapshot = {
  questions: Question[];
  currentQuestionIndex: number;
  userAnswer: string;
  results: TestResult[];
  currentResult: {
    isCorrect: boolean;
    feedback: string;
  } | null;
  isAnswered: boolean;
  timeLeft: number | null;
  generatedQuestionCount: number;
};

export default function Home() {
  const [view, setView] = useState<
    "upload" | "studying" | "summarizing" | "testing" | "results"
  >("upload");
  const [documentInfo, setDocumentInfo] = useState<{
    text: string;
    file: { name: string; type: string; size: number };
  } | null>(null);
  const [initialQuestions, setInitialQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [testSettings, setTestSettings] = useState<TestSettings | null>(null);
  const [effectiveDocumentText, setEffectiveDocumentText] = useState("");
  const [totalGeneratedQuestions, setTotalGeneratedQuestions] =
    useState<number>(0);
  const [pendingRestore, setPendingRestore] =
    useState<RestoredTestProgress | null>(null);
  const [restoreSnapshot, setRestoreSnapshot] =
    useState<TestRestoreSnapshot | null>(null);
  const [showRestoredSessionNotice, setShowRestoredSessionNotice] =
    useState(false);
  const [testOrigin, setTestOrigin] = useState<"studying" | "summarizing">(
    "studying",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await loadTestProgress();
        if (cancelled || !parsed) return;

        if (
          !parsed.documentInfo ||
          !parsed.settings ||
          !Array.isArray(parsed.questions) ||
          parsed.questions.length === 0
        ) {
          return;
        }

        const typed = parsed as RestoredTestProgress;
        const questions = typed.questions ?? [];
        if (questions.length === 0) return;

        const boundedIndex =
          typeof typed.currentQuestionIndex === "number"
            ? Math.max(
                0,
                Math.min(
                  typed.currentQuestionIndex,
                  questions.length - 1,
                ),
              )
            : 0;

        setPendingRestore({
          ...typed,
          questions,
          currentQuestionIndex: boundedIndex,
          results: Array.isArray(typed.results) ? typed.results : [],
          currentResult: typed.currentResult ?? null,
          userAnswer:
            typeof typed.userAnswer === "string" ? typed.userAnswer : "",
          isAnswered: Boolean(typed.isAnswered),
          timeLeft:
            typeof typed.timeLeft === "number" || typed.timeLeft === null
              ? typed.timeLeft
              : null,
          generatedQuestionCount:
            typeof typed.generatedQuestionCount === "number"
              ? typed.generatedQuestionCount
              : questions.length,
        });
      } catch (error) {
        console.error("Failed to restore test session in page:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleContinueSavedTest = () => {
    if (
      !pendingRestore?.documentInfo ||
      !pendingRestore.settings ||
      !Array.isArray(pendingRestore.questions) ||
      pendingRestore.questions.length === 0
    ) {
      setPendingRestore(null);
      return;
    }

    const normalizedIndex =
      typeof pendingRestore.currentQuestionIndex === "number"
        ? Math.max(
            0,
            Math.min(
              pendingRestore.currentQuestionIndex,
              pendingRestore.questions.length - 1,
            ),
          )
        : 0;
    const normalizedResults = Array.isArray(pendingRestore.results)
      ? pendingRestore.results
      : [];

    setDocumentInfo({
      text: pendingRestore.documentInfo.text,
      file: pendingRestore.documentInfo.file ?? {
        name: "restored-document",
        type: "text/plain",
        size: pendingRestore.documentInfo.text.length,
      },
    });
    setTestSettings(pendingRestore.settings);
    setInitialQuestions(pendingRestore.questions);
    setEffectiveDocumentText(
      pendingRestore.effectiveDocumentText || pendingRestore.documentInfo.text,
    );
    setRestoreSnapshot({
      questions: pendingRestore.questions,
      currentQuestionIndex: normalizedIndex,
      userAnswer:
        typeof pendingRestore.userAnswer === "string"
          ? pendingRestore.userAnswer
          : "",
      results: normalizedResults,
      currentResult: pendingRestore.currentResult ?? null,
      isAnswered: Boolean(pendingRestore.isAnswered),
      timeLeft:
        typeof pendingRestore.timeLeft === "number" ||
        pendingRestore.timeLeft === null
          ? pendingRestore.timeLeft
          : null,
      generatedQuestionCount:
        typeof pendingRestore.generatedQuestionCount === "number"
          ? pendingRestore.generatedQuestionCount
          : pendingRestore.questions.length,
    });
    setShowRestoredSessionNotice(true);
    setPendingRestore(null);
    setView("testing");
  };

  const handleStartFreshInstead = () => {
    clearTestProgress().catch((err) =>
      console.error("Failed to clear test progress:", err),
    );
    setPendingRestore(null);
    setRestoreSnapshot(null);
    setShowRestoredSessionNotice(false);
  };

  const handleDocumentUploaded = (
    docText: string,
    docFile: { name: string; type: string; size: number },
  ) => {
    setDocumentInfo({ text: docText, file: docFile });
    setEffectiveDocumentText(docText);
    setRestoreSnapshot(null);
    setShowRestoredSessionNotice(false);
    setView("studying");
  };

  const handleStartTestCreation = (origin: "studying" | "summarizing") => {
    setTestOrigin(origin);
    setView("upload"); // Reuse upload view for test settings
  };

  const handleSummarize = () => {
    setView("summarizing");
  };

  const handleTestGenerated = (
    generatedQuestions: Question[],
    settings: TestSettings,
    nextEffectiveDocumentText: string,
  ) => {
    setInitialQuestions(generatedQuestions);
    setTestSettings(settings);
    setEffectiveDocumentText(nextEffectiveDocumentText);
    setRestoreSnapshot(null);
    setShowRestoredSessionNotice(false);
    setView("testing");
  };

  const handleTestFinished = (
    finalResults: TestResult[],
    totalGenerated: number,
  ) => {
    setResults(finalResults);
    setTotalGeneratedQuestions(totalGenerated);
    setView("results");
  };

  const handleStartNew = () => {
    setView("upload");
    setInitialQuestions([]);
    setDocumentInfo(null);
    setResults([]);
    setTestSettings(null);
    setEffectiveDocumentText("");
    setTotalGeneratedQuestions(0);
    setPendingRestore(null);
    setRestoreSnapshot(null);
    setShowRestoredSessionNotice(false);
  };

  const renderView = () => {
    switch (view) {
      case "upload":
        return (
          <UploadView
            onDocumentUploaded={handleDocumentUploaded}
            onTestGenerated={handleTestGenerated}
            existingDocument={documentInfo}
            onBack={() => setView(testOrigin)}
          />
        );
      case "studying":
        return (
          documentInfo && (
            <StudyView
              document={documentInfo.file}
              documentText={documentInfo.text}
              onStartTest={() => handleStartTestCreation("studying")}
              onStartNew={handleStartNew}
              onSummarize={handleSummarize}
            />
          )
        );
      case "summarizing":
        return (
          documentInfo && (
            <SummaryView
              documents={[{
                name: documentInfo.file.name,
                type: documentInfo.file.type,
                text: documentInfo.text,
              }]}
              onStartTest={() => handleStartTestCreation("summarizing")}
              onStartNew={handleStartNew}
              onBack={() => setView("studying")}
            />
          )
        );
      case "testing":
        return (
          documentInfo &&
          testSettings && (
            <TestView
              initialQuestions={initialQuestions}
              documentInfo={documentInfo}
              effectiveDocumentText={effectiveDocumentText || documentInfo.text}
              settings={testSettings}
              onTestFinished={handleTestFinished}
              showRestoreNotice={showRestoredSessionNotice}
              restoreSnapshot={restoreSnapshot}
              onBack={() => setView(testOrigin)}
            />
          )
        );
      case "results":
        return (
          <ResultsView
            results={results}
            onStartNew={handleStartNew}
            requestedQuestionCount={testSettings?.numberOfQuestions}
            totalQuestionsGenerated={totalGeneratedQuestions}
            onBack={() => setView(testOrigin)}
          />
        );
      default:
        return (
          <UploadView
            onDocumentUploaded={handleDocumentUploaded}
            onTestGenerated={handleTestGenerated}
          />
        );
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <AlertDialog open={Boolean(pendingRestore)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume previous test session?</AlertDialogTitle>
            <AlertDialogDescription>
              We found saved progress from your last test on this device.
              Continue where you left off or start a fresh test.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStartFreshInstead}>
              Start Fresh
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleContinueSavedTest}>
              Continue Test
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Header />
      <main className="flex-grow container mx-auto px-4 py-8 flex flex-col">
        {renderView()}
      </main>
      <Toaster />
    </div>
  );
}
