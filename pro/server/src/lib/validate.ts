import type { ZodTypeAny, z } from "zod";
import { badRequest } from "./errors.js";

export function parse<T extends ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest("Invalid request", result.error.flatten());
  }
  return result.data;
}
