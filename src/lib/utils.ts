import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

export function extractMermaidDiagrams(markdown: string): { diagram: string; index: number }[] {
  const regex = /```mermaid\s*([\s\S]*?)```/g;
  const matches: { diagram: string; index: number }[] = [];
  let match;
  let index = 0;
  while ((match = regex.exec(markdown)) !== null) {
    if (match[1]) {
      matches.push({ diagram: match[1].trim(), index: index++ });
    }
  }
  return matches;
}
