import { useCallback, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_KEY = 'desk-theme';
const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Light/dark set data-theme on <html>; system removes it so the media query decides. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* preference only */
  }
}

/** Three-state theme: system -> light -> dark -> system. */
export function useTheme(): { theme: ThemeChoice; cycle: () => void } {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system';
    saveTheme(next);
    applyTheme(next);
    setTheme(next);
  }, [theme]);
  return { theme, cycle };
}
