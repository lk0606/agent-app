import { chatMessages } from "@/locales/chat/message";
import { commonMessages } from "@/locales/common/message";
import { sessionsMessages } from "@/locales/sessions/message";

import { pickLocale } from "./pick-locale";
import type { AppLocale } from "./routing";

export function getMessages(locale: AppLocale) {
  return {
    chat: pickLocale(chatMessages, locale),
    common: pickLocale(commonMessages, locale),
    sessions: pickLocale(sessionsMessages, locale),
  };
}
