'use client';

import { useState, useEffect, useRef } from 'react';
import { answerDocumentQuestion, type AnswerDocumentQuestionOutput } from '@/ai/flows/answer-document-question';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, MessageCircleQuestion, FileText, Pencil, PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type StudyViewProps = {
    document: { name: string, type: string };
    documentText: string;
    onStartTest: () => void;
    onStartNew: () => void;
    onSummarize?: () => void;
};

function QnaSection({ documentText }: { documentText: string }) {
    const { toast } = useToast();
    const [qnaQuestion, setQnaQuestion] = useState('');
    const [qnaAnswer, setQnaAnswer] = useState<AnswerDocumentQuestionOutput | null>(null);
    const [isQnaLoading, setIsQnaLoading] = useState(false);

    const handleQnaSubmit = async () => {
        if (!qnaQuestion) return;

        setIsQnaLoading(true);
        setQnaAnswer(null);
        try {
            const result = await answerDocumentQuestion({
                documentContent: documentText,
                question: qnaQuestion,
            });
            setQnaAnswer(result);
        } catch (error) {
            console.error('Q&A Error:', error);
            const errorMessage = (error as Error)?.message || 'An unknown error occurred.';
            const isServiceUnavailable = errorMessage.includes('503') || errorMessage.toLowerCase().includes('overloaded');

            toast({
                variant: 'destructive',
                title: isServiceUnavailable ? 'AI Service Unavailable' : 'Error Getting Answer',
                description: isServiceUnavailable 
                    ? "The AI model is temporarily overloaded. Please try asking again in a moment."
                    : 'There was a problem communicating with the AI.',
            });
        } finally {
            setIsQnaLoading(false);
        }
    };
    
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
                <MessageCircleQuestion className="h-5 w-5" />
                Ask Your Document
            </h3>
            <div className="flex gap-2">
                <Input
                    placeholder="Ask a question about the document..."
                    value={qnaQuestion}
                    onChange={(e) => setQnaQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleQnaSubmit()}
                    disabled={isQnaLoading}
                />
                <Button onClick={handleQnaSubmit} disabled={isQnaLoading || !qnaQuestion}>
                    {isQnaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ask'}
                </Button>
            </div>
            {isQnaLoading && (
                <div className="p-4 rounded-md border bg-muted flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Thinking...</span>
                </div>
            )}
            {qnaAnswer && (
                <Card className="bg-background/50">
                    <CardContent className="p-4 space-y-2">
                        <p className="font-semibold text-primary flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI Answer</p>
                        <p className="text-sm">{qnaAnswer.answer}</p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function DocumentPreview({ file, textContent }: { file: { name: string, type: string }, textContent: string }) {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold">Extracted Text</h3>
            <ScrollArea className="h-96 w-full rounded-md border p-4">
                <p className="text-sm whitespace-pre-wrap">{textContent}</p>
            </ScrollArea>
        </div>
    );
}

export function StudyView({ document, documentText, onStartTest, onStartNew, onSummarize }: StudyViewProps) {
    return (
        <div className="w-full max-w-5xl mx-auto flex-grow flex flex-col space-y-6 animate-in fade-in-50 duration-500">
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                        <div>
                            <CardTitle className="text-3xl font-bold font-headline flex items-center gap-2">
                                <FileText className="h-7 w-7" />
                                {document.name}
                            </CardTitle>
                            <CardDescription>Review the content and ask the AI questions before you start the test.</CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button onClick={onStartNew} variant="outline">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Start New
                            </Button>
                            {onSummarize && (
                                <Button onClick={onSummarize} variant="secondary">
                                    <Sparkles className="mr-2 h-4 w-4" />
                                    Summarize
                                </Button>
                            )}
                            <Button onClick={onStartTest} size="lg">
                                <Pencil className="mr-2 h-4 w-4" />
                                Create Test
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-8">
                     <QnaSection documentText={documentText} />
                     <DocumentPreview file={document} textContent={documentText} />
                </CardContent>
            </Card>
        </div>
    );
}
