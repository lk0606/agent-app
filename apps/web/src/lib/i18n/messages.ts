import { chatMessages } from "@/locales/chat/message";
import { commonMessages } from "@/locales/common/message";

import { pickLocale } from "./pick-locale";
import type { AppLocale } from "./routing";

export function getMessages(locale: AppLocale) {
  return {
    chat: pickLocale(chatMessages, locale),
    common: pickLocale(commonMessages, locale),
  };
}
