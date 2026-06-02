"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const t = useTranslations("common.theme");
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <button
      aria-label={t("toggle")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-panel text-foreground transition hover:bg-muted"
      type="button"
      onClick={() => setTheme(nextTheme)}
    >
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </button>
  );
}
