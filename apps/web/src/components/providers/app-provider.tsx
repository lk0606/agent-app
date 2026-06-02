import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import type { AppLocale } from "@/lib/i18n/routing";

import { ThemeProvider } from "./theme-provider";

export function AppProvider({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: AppLocale;
  messages: Record<string, unknown>;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}
