import { BookMarked } from 'lucide-react';

export function Header() {
    return (
        <header className="bg-card shadow-sm sticky top-0 z-40">
            <div className="container mx-auto px-4 py-3 flex items-center gap-3">
                <BookMarked className="h-8 w-8 text-primary" />
                <h1 className="text-2xl font-bold text-primary font-headline">StudyBuddy AI</h1>
            </div>
        </header>
    );
}
