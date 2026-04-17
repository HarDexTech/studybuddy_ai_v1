"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/app/header";
import { UploadView } from "@/components/app/upload-view";
import { StudyView } from "@/components/app/study-view";
import { TestView } from "@/components/app/test-view";
import { ResultsView } from "@/components/app/results-view";
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
import type { TestResult, TestSettings, Question } from "@/lib/types";

const TEST_PROGRESS_KEY = "studybuddy-active-test-progress";

type StoredTestProgress = {
  docSignature?: string;
  settingsSignature?: string;
  questions?: Question[];
  settings?: TestSettings;
  documentInfo?: {
    text: string;
    file: { name: string; type: string; size: number };
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

type SharedPreloadEntry = {
  key: string;
  createdAt: number;
  questions: Question[];
  effectiveDocumentText: string;
};

type SharedPreloadStatus =
  | "idle"
  | "scheduled"
  | "preloading"
  | "ready"
  | "cache-hit"
  | "error";

export default function Home() {
  const [view, setView] = useState<
    "upload" | "studying" | "testing" | "results"
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
    useState<StoredTestProgress | null>(null);
  const [restoreSnapshot, setRestoreSnapshot] =
    useState<TestRestoreSnapshot | null>(null);
  const [showRestoredSessionNotice, setShowRestoredSessionNotice] =
    useState(false);
  const [preloadActivationId, setPreloadActivationId] = useState(0);
  const [sharedPreload, setSharedPreload] = useState<{
    entry: SharedPreloadEntry | null;
    status: SharedPreloadStatus;
  }>({
    entry: null,
    status: "idle",
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(TEST_PROGRESS_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as StoredTestProgress;

      if (
        !parsed.documentInfo ||
        !parsed.settings ||
        !Array.isArray(parsed.questions) ||
        parsed.questions.length === 0
      ) {
        return;
      }

      const boundedIndex =
        typeof parsed.currentQuestionIndex === "number"
          ? Math.max(
              0,
              Math.min(
                parsed.currentQuestionIndex,
                parsed.questions.length - 1,
              ),
            )
          : 0;

      setPendingRestore({
        ...parsed,
        currentQuestionIndex: boundedIndex,
        results: Array.isArray(parsed.results) ? parsed.results : [],
        currentResult: parsed.currentResult ?? null,
        userAnswer:
          typeof parsed.userAnswer === "string" ? parsed.userAnswer : "",
        isAnswered: Boolean(parsed.isAnswered),
        timeLeft:
          typeof parsed.timeLeft === "number" || parsed.timeLeft === null
            ? parsed.timeLeft
            : null,
        generatedQuestionCount:
          typeof parsed.generatedQuestionCount === "number"
            ? parsed.generatedQuestionCount
            : parsed.questions.length,
      });
    } catch (error) {
      console.error("Failed to restore test session in page:", error);
    }
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

    setDocumentInfo(pendingRestore.documentInfo);
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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TEST_PROGRESS_KEY);
    }
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
    setSharedPreload({ entry: null, status: "idle" });
    setRestoreSnapshot(null);
    setShowRestoredSessionNotice(false);
    setView("studying");
  };

  const handleStartTestCreation = () => {
    setPreloadActivationId((prev) => prev + 1);
    setView("upload"); // Reuse upload view for test settings
  };

  const handleTestGenerated = (
    generatedQuestions: Question[],
    settings: TestSettings,
    nextEffectiveDocumentText: string,
  ) => {
    setInitialQuestions(generatedQuestions);
    setTestSettings(settings);
    setEffectiveDocumentText(nextEffectiveDocumentText);
    setSharedPreload({ entry: null, status: "idle" });
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
    setSharedPreload({ entry: null, status: "idle" });
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
            preloadActivationId={preloadActivationId}
            sharedPreload={sharedPreload.entry}
            sharedPreloadStatus={sharedPreload.status}
            onSharedPreloadChange={(entry, status) =>
              setSharedPreload({ entry, status })
            }
          />
        );
      case "studying":
        return (
          documentInfo && (
            <StudyView
              document={documentInfo.file}
              documentText={documentInfo.text}
              onStartTest={handleStartTestCreation}
              onStartNew={handleStartNew}
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
          />
        );
      default:
        return (
          <UploadView
            onDocumentUploaded={handleDocumentUploaded}
            onTestGenerated={handleTestGenerated}
            preloadActivationId={0}
            sharedPreload={sharedPreload.entry}
            sharedPreloadStatus={sharedPreload.status}
            onSharedPreloadChange={(entry, status) =>
              setSharedPreload({ entry, status })
            }
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
