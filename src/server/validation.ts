import type { z } from 'zod';
import { validationError } from './errors';

/** Parses service input; failures become VALIDATION_ERROR with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.') || '_';
    (fieldErrors[path] ??= []).push(issue.message);
  }
  throw validationError(fieldErrors);
}
