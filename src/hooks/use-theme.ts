"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
export const THEME_KEY = "doing-nothing:theme:v1";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("system");
  const [dark, setDark] = useState(false);
  const apply = useCallback((value: Theme) => {
    const isDark =
      value === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : value === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    setTheme(value);
    setDark(isDark);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let value: Theme = "system";
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") value = stored;
    } catch {
      /* Default to the device theme when preferences cannot be read. */
    }
    const frame = requestAnimationFrame(() => apply(value));
    const sync = () => {
      let preferred: string | null = null;
      try {
        preferred = localStorage.getItem(THEME_KEY);
      } catch {
        /* Use system. */
      }
      if (preferred !== "light" && preferred !== "dark") apply("system");
    };
    media.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", sync);
    };
  }, [apply]);

  const choose = (value: Theme) => {
    apply(value);
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {
      /* Visual feedback still works. */
    }
  };
  return {
    theme,
    dark,
    toggle: () => choose(dark ? "light" : "dark"),
    useSystem: () => choose("system"),
  };
}
