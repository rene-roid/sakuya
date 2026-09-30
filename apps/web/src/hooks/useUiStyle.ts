import { useQuery } from '@tanstack/react-query';
import type { UiStyle } from '@sakuya/shared';
import { api } from '../lib/api';

// Mirrors the server setting so the right style paints before settings load (and on the login gate).
const STORAGE_KEY = 'sakuya:ui-style';

export function storedUiStyle(): UiStyle {
  return localStorage.getItem(STORAGE_KEY) === 'classic' ? 'classic' : 'glass';
}

/** Sets `data-ui` on <html>, which switches the CSS tokens and every `glass:` utility. */
export function applyUiStyle(style: UiStyle) {
  document.documentElement.dataset.ui = style;
  localStorage.setItem(STORAGE_KEY, style);
}

export function useUiStyle(): UiStyle {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  return data?.ui_style ?? storedUiStyle();
}
