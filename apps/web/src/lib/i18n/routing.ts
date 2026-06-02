export const locales = ["zh-CN", "en-US"] as const;

export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "zh-CN";

export function hasLocale(locale: string): locale is AppLocale {
  return locales.includes(locale as AppLocale);
}
