// lib/theme.ts
export type Theme = 'jedi' | 'sith';

export function themeColors(theme: Theme) {
  if (theme === 'sith') {
    return { leftColor: '#1a0f14' };
  }
  // default Jedi/space-blue palette
  return { leftColor: '#141a2a' };
}
