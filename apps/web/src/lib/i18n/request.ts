import { getRequestConfig } from "next-intl/server";

import { getMessages } from "./messages";
import { defaultLocale, hasLocale } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;
  const resolvedLocale = locale && hasLocale(locale) ? locale : defaultLocale;

  // 这里主要服务 next-intl 的运行时上下文；路由合法性由 app/[locale]/layout.tsx 负责拦截。
  return {
    locale: resolvedLocale,
    messages: getMessages(resolvedLocale),
  };
});
