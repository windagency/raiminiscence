import { z } from "zod";

/** `raw` when it's one of `allowed`, otherwise `undefined`. */
export function parseAllowedValue<T extends string>(raw: string, allowed: readonly T[]): T | undefined {
  const result = z.enum(allowed as [T, ...T[]]).safeParse(raw);
  return result.success ? result.data : undefined;
}

/** `raw` coerced to a number, or `undefined` when it isn't numeric (NaN included). */
export function parseNumberValue(raw: string): number | undefined {
  const result = z.coerce.number().safeParse(raw);
  return result.success ? result.data : undefined;
}

/** `raw` coerced to a `Date`, or `undefined` when it isn't a parseable date. */
export function parseDateValue(raw: string): Date | undefined {
  const result = z.coerce.date().safeParse(raw);
  return result.success ? result.data : undefined;
}
