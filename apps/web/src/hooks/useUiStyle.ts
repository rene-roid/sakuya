import type { UiStyle } from '@sakuya/shared';
import { useSettings } from './useSettings';

// Mirrors the server setting so the right style paints before settings load (and on the login gate).
const STORAGE_KEY = 'sakuya:ui-style';

export function storedUiStyle(): UiStyle {
  return localStorage.getItem(STORAGE_KEY) === 'glass' ? 'glass' : 'classic';
}

/** Sets `data-ui` on <html>, which switches the CSS tokens and every `glass:` utility. */
export function applyUiStyle(style: UiStyle) {
  document.documentElement.dataset.ui = style;
  localStorage.setItem(STORAGE_KEY, style);
}

export function useUiStyle(): UiStyle {
  return useSettings()?.ui_style ?? storedUiStyle();
}
