import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContext {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeContext>({ theme: "system", setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("pk-theme") as Theme) ?? "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.removeAttribute("data-theme");
    if (theme === "system") {
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", dark);
    } else {
      root.classList.toggle("dark", theme === "dark");
      root.setAttribute("data-theme", theme);
    }
    localStorage.setItem("pk-theme", theme);
  }, [theme]);

  return <Ctx.Provider value={{ theme, setTheme: setThemeState }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
