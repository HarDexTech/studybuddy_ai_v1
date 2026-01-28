'use client';

import { useState } from 'react';
import { Header } from '@/components/app/header';
import { UploadView } from '@/components/app/upload-view';
import { StudyView } from '@/components/app/study-view';
import { TestView } from '@/components/app/test-view';
import { ResultsView } from '@/components/app/results-view';
import type { TestResult, TestSettings, Question } from '@/lib/types';

export default function Home() {
    const [view, setView] = useState<'upload' | 'studying' | 'testing' | 'results'>('upload');
    const [documentInfo, setDocumentInfo] = useState<{ text: string; file: { name: string, type: string, size: number } } | null>(null);
    const [initialQuestions, setInitialQuestions] = useState<Question[]>([]);
    const [results, setResults] = useState<TestResult[]>([]);
    const [testSettings, setTestSettings] = useState<TestSettings | null>(null);
    const [totalGeneratedQuestions, setTotalGeneratedQuestions] = useState<number>(0);

    const handleDocumentUploaded = (docText: string, docFile: { name: string, type: string, size: number }) => {
        setDocumentInfo({ text: docText, file: docFile });
        setView('studying');
    };

    const handleStartTestCreation = () => {
        setView('upload'); // Reuse upload view for test settings
    }

    const handleTestGenerated = (generatedQuestions: Question[], settings: TestSettings) => {
        setInitialQuestions(generatedQuestions);
        setTestSettings(settings);
        setView('testing');
    };

    const handleTestFinished = (finalResults: TestResult[], totalGenerated: number) => {
        setResults(finalResults);
        setTotalGeneratedQuestions(totalGenerated);
        setView('results');
    };

    const handleStartNew = () => {
        setView('upload');
        setInitialQuestions([]);
        setDocumentInfo(null);
        setResults([]);
        setTestSettings(null);
        setTotalGeneratedQuestions(0);
    };

    const renderView = () => {
        switch (view) {
            case 'upload':
                return <UploadView onDocumentUploaded={handleDocumentUploaded} onTestGenerated={handleTestGenerated} existingDocument={documentInfo} />;
            case 'studying':
                return documentInfo && <StudyView document={documentInfo.file} documentText={documentInfo.text} onStartTest={handleStartTestCreation} onStartNew={handleStartNew} />;
            case 'testing':
                return documentInfo && testSettings && (
                    <TestView
                        initialQuestions={initialQuestions}
                        documentInfo={documentInfo}
                        settings={testSettings}
                        onTestFinished={handleTestFinished}
                    />
                );
            case 'results':
                return (
                    <ResultsView 
                        results={results} 
                        onStartNew={handleStartNew} 
                        requestedQuestionCount={testSettings?.numberOfQuestions}
                        totalQuestionsGenerated={totalGeneratedQuestions}
                    />
                );
            default:
                return <UploadView onDocumentUploaded={handleDocumentUploaded} onTestGenerated={handleTestGenerated} />;
        }
    }

    return (
        <div className="flex flex-col min-h-screen bg-background text-foreground">
            <Header />
            <main className="flex-grow container mx-auto px-4 py-8 flex flex-col">
                {renderView()}
            </main>
        </div>
    );
}