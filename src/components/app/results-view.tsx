'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { TestResult } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CheckCircle2, XCircle, Download } from 'lucide-react';

type ResultsViewProps = {
    results: TestResult[];
    onStartNew: () => void;
};


const PieChart = ({ score, size = 200 }: { score: number, size?: number }) => {
    const strokeWidth = 15;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 transform">
                {/* Background Circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="hsl(var(--secondary))"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                />
                {/* Foreground Circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-in-out"
                />
            </svg>
             <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-5xl font-bold" style={{color: 'hsl(var(--chart-1))'}}>{Math.round(score)}%</p>
            </div>
        </div>
    );
};


export function ResultsView({ results, onStartNew }: ResultsViewProps) {
    const correctAnswers = results.filter(r => r.isCorrect).length;
    const totalQuestions = results.length;
    const scorePercentage = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

    const handleDownloadPdf = () => {
        const doc = new jsPDF();
        doc.setFontSize(20);
        doc.text("Test Results", 15, 20);
        doc.setFontSize(12);
        doc.text(`Score: ${Math.round(scorePercentage)}% (${correctAnswers}/${totalQuestions} correct)`, 15, 30);
        
        const tableColumn = ["#", "Question", "Your Answer", "Result", "Feedback"];
        const tableRows: (string | number)[][] = [];

        results.forEach((result, index) => {
            const row = [
                index + 1,
                result.question.question,
                result.userAnswer || 'Skipped',
                result.isCorrect ? 'Correct' : 'Incorrect',
                result.feedback
            ];
            tableRows.push(row);
        });

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 40,
            headStyles: { fillColor: [44, 43, 60] },
            styles: { cellPadding: 2, fontSize: 8, cellWidth: 'wrap' },
            columnStyles: {
                0: { cellWidth: 10 },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 'auto' },
                3: { cellWidth: 20 },
                4: { cellWidth: 'auto' }
            }
        });

        doc.save('test-results.pdf');
    };

    return (
        <div className="w-full max-w-3xl mx-auto flex-grow flex flex-col items-center justify-center animate-in fade-in-50 duration-500">
            <Card className="w-full">
                <CardHeader className="text-center">
                    <CardTitle className="text-4xl font-bold font-headline">Test Complete!</CardTitle>
                    <CardDescription>Here's how you did.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                    <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8">
                        <div className="flex-shrink-0">
                           <PieChart score={scorePercentage} />
                        </div>
                        <div className="text-center md:text-left">
                            
                            <p className="text-3xl text-muted-foreground font-semibold">{correctAnswers} / {totalQuestions} Correct</p>
                        </div>
                    </div>
                    
                    <div>
                        <h3 className="text-xl font-semibold mb-4 text-center">Review Your Answers</h3>
                        <Accordion type="single" collapsible className="w-full">
                            {results.map((result, index) => (
                                <AccordionItem value={`item-${index}`} key={index}>
                                    <AccordionTrigger>
                                        <div className="flex items-center gap-3 w-full">
                                            {result.isCorrect ? (
                                                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                                            ) : (
                                                <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                                            )}
                                            <span className="truncate flex-1 text-left">Question {index + 1}: {result.question.question}</span>
                                        </div>

                                    </AccordionTrigger>
                                    <AccordionContent className="space-y-3 pl-8">
                                        <p><strong>Your Answer:</strong> <span className="font-mono p-1 bg-muted rounded text-sm">{result.userAnswer || 'Skipped'}</span></p>
                                        <p><strong>Feedback:</strong> {result.feedback}</p>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </div>

                    <div className="flex flex-wrap justify-center gap-4 pt-4">
                        <Button onClick={onStartNew} size="lg">
                            Take a New Test
                        </Button>
                        <Button onClick={handleDownloadPdf} variant="outline" size="lg">
                            <Download className="mr-2 h-4 w-4" />
                            Download PDF
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
