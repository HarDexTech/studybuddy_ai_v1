'use client';

import type { CachedDocument } from './types';

const RECENT_DOCS_KEY = 'studybuddy-recent-docs';
const MAX_RECENT_DOCS = 10;

export function getRecentDocuments(): CachedDocument[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(RECENT_DOCS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to get recent documents from localStorage:', error);
    return [];
  }
}

export function addRecentDocument(doc: CachedDocument) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    let docs = getRecentDocuments();
    // Remove the document if it already exists to move it to the top
    docs = docs.filter((d) => d.id !== doc.id);
    // Add the new document to the beginning
    docs.unshift(doc);
    // Trim the list to the max size
    const trimmedDocs = docs.slice(0, MAX_RECENT_DOCS);
    window.localStorage.setItem(RECENT_DOCS_KEY, JSON.stringify(trimmedDocs));
  } catch (error) {
    console.error('Failed to add recent document to localStorage:', error);
  }
}

export function removeRecentDocument(docId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const docs = getRecentDocuments().filter((doc) => doc.id !== docId);
    window.localStorage.setItem(RECENT_DOCS_KEY, JSON.stringify(docs));
  } catch (error) {
    console.error('Failed to remove recent document from localStorage:', error);
  }
}

export function clearRecentDocuments() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(RECENT_DOCS_KEY);
  } catch (error) {
    console.error('Failed to clear recent documents from localStorage:', error);
  }
}
