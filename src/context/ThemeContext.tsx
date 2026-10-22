"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

type Theme = "dark" | "light";

const THEME_EVENT = "seapulse-theme";

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_EVENT, onStoreChange);
}

function readServerTheme(): Theme {
  return "dark";
}

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, readServerTheme);

  function toggleTheme() {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("seapulse-theme", next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
