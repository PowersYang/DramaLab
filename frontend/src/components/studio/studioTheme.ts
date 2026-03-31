"use client";

export type StudioTheme = "light" | "dark";

export const STUDIO_THEME_STORAGE_KEY = "dramalab-studio-theme";
export const LEGACY_STUDIO_THEME_STORAGE_KEY = "lumenx-studio-theme";

export function readStoredStudioTheme(): StudioTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const savedTheme =
    window.localStorage.getItem(STUDIO_THEME_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_STUDIO_THEME_STORAGE_KEY);

  return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
}

export function persistStudioTheme(theme: StudioTheme) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STUDIO_THEME_STORAGE_KEY, theme);
  window.localStorage.removeItem(LEGACY_STUDIO_THEME_STORAGE_KEY);
}
