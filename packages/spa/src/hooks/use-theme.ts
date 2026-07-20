import { useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark" | "system";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("pk-theme") as Theme | null;
    return stored ?? "system";
  });

  const resolved = resolveTheme(theme);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem("pk-theme", next);
    setThemeState(next);
    apply(resolveTheme(next));
  }, []);

  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => apply(resolveTheme("system"));
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, resolved, setTheme } as const;
}
