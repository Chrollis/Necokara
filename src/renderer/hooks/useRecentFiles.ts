import { useState, useCallback } from 'react';

export interface RecentFileEntry {
  filePath: string;
  fileName: string;
  dir: string;
}

const STORAGE_KEY = 'necokara_recent';
const MAX_RECENT = 5;

function loadRecent(): RecentFileEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(loadRecent);

  const addRecentFile = useCallback((filePath: string) => {
    setRecentFiles((prev) => {
      const filtered = prev.filter((f) => f.filePath !== filePath);
      const parts = filePath.split(/[/\\]/);
      const entry: RecentFileEntry = {
        filePath,
        fileName: parts.pop() || '',
        dir: parts.join('/') || parts.join('\\'),
      };
      const next = [entry, ...filtered].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recentFiles, addRecentFile };
}
