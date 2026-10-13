import { motion } from "motion/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";

/** Sun / moon button that switches between the pastel light theme and the navy dark theme. */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`grid size-9 place-items-center rounded-xl text-ink-soft transition hover:bg-surface/60 hover:text-accent ${className}`}
    >
      <motion.span key={theme} initial={{ rotate: -90, scale: 0.6, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ duration: 0.3 }} className="grid place-items-center">
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </motion.span>
    </button>
  );
}
