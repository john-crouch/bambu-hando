// ABOUTME: Error formatting shared by sync and source loading.
// ABOUTME: Surfaces the cause that fetch hides behind a generic "fetch failed".

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // fetch hides the useful part (ECONNREFUSED, timeout) in the cause.
    const cause = err.cause instanceof Error ? `: ${err.cause.message}` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}
