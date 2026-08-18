'use client';

import { useEffect } from 'react';
import { applyTheme, getSavedThemeId } from '../lib/theme';
import { applyFont, getSavedFontId } from '../lib/font';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme(getSavedThemeId());
    applyFont(getSavedFontId());
  }, []);
  return <>{children}</>;
}
