/** The message of anything thrown, for user-facing error text. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
