/** 把 api-contract 的 Zod schema 失败转成统一的 400 BAD_REQUEST */
import { AppError } from "../shared/app-error.js";

type SafeParseResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: {
        issues: Array<{
          path: PropertyKey[];
          message: string;
        }>;
      };
    };

export interface SafeParseSchema<T> {
  safeParse(input: unknown): SafeParseResult<T>;
}

export function parseSchema<T>(schema: SafeParseSchema<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "root";
    return `${path}: ${issue.message}`;
  });
  const verb = label.endsWith("parameters") ? "are" : "is";
  // details 经 buildErrorPayload 透出到 HTTP error.details，供 curl/前端定位字段错误
  throw new AppError("BAD_REQUEST", `${label} ${verb} invalid.`, { details });
}
