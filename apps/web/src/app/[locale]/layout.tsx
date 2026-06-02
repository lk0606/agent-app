import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppProvider } from "@/components/providers/app-provider";
import { getMessages } from "@/lib/i18n/messages";
import { hasLocale, locales } from "@/lib/i18n/routing";

import "../globals.css";

export const metadata: Metadata = {
  title: "Agent Workbench",
  description: "A fullstack workbench for testing Node Agent applications.",
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  if (!hasLocale(locale)) {
    notFound();
  }

  const messages = getMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <AppProvider locale={locale} messages={messages}>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
