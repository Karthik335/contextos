// Light / dark theme. Stored in this browser; follows the system setting until the user picks one.
import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "contextos-theme";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
export const resolve = (c: ThemeChoice): "light" | "dark" => (c === "system" ? (systemDark() ? "dark" : "light") : c);

function apply(c: ThemeChoice) {
  document.documentElement.dataset.theme = resolve(c);
}

/** React hook: current theme + a toggle. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [choice]);
  useEffect(() => {
    const sync = () => setChoice(read());
    window.addEventListener("contextos-theme", sync);
    return () => window.removeEventListener("contextos-theme", sync);
  }, []);
  const theme = resolve(choice);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: still switch for this session */
    }
    setChoice(next);
    window.dispatchEvent(new Event("contextos-theme"));
  };
  return { theme, toggle };
}
