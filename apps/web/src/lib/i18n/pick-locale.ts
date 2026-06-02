import { defaultLocale, type AppLocale } from "./routing";

type LocaleLeaf = Partial<Record<AppLocale, string>>;
type LocaleTree = {
  [key: string]: LocaleTree | LocaleLeaf;
};

export function pickLocale(messages: LocaleTree, locale: AppLocale): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [key, pickValue(value, locale)]),
  );
}

function pickValue(value: LocaleTree | LocaleLeaf, locale: AppLocale): unknown {
  if (isLocaleLeaf(value)) {
    return value[locale] ?? value[defaultLocale] ?? "";
  }

  return pickLocale(value, locale);
}

function isLocaleLeaf(value: LocaleTree | LocaleLeaf): value is LocaleLeaf {
  return defaultLocale in value;
}
