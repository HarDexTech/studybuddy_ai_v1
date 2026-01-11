'use client';

import { Inter, Lexend } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const lexend = Lexend({
  subsets: ['latin'],
  variable: '--font-lexend',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <title>StudyBuddy AI</title>
        <meta name="description" content="Upload documents and generate tests to supercharge your study sessions." />
      </head>
      <body className={`${inter.variable} ${lexend.variable} font-body antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
