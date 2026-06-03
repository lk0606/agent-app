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

  throw new AppError("BAD_REQUEST", `${label} ${verb} invalid.`, { details });
}
