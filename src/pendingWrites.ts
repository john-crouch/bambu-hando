// ABOUTME: The writes still running (files, keyring entries), so the binary can let them finish before it exits.
// ABOUTME: Only writes register here: a download the user walked away from must never hold the process open.

const pending = new Set<Promise<unknown>>();

/** Registers a write until it settles and hands back the same promise, so callers see its result as before. */
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  pending.add(write);
  const forget = () => pending.delete(write);
  write.then(forget, forget);
  return write;
}

/**
 * Resolves true once every registered write has settled, those started meanwhile included, or false when
 * limitMs passes first (a keyring call stuck on an unlock prompt must not hold the exit forever); never rejects.
 */
export async function writesSettled(limitMs = Number.POSITIVE_INFINITY): Promise<boolean> {
  const all = (async () => {
    while (pending.size > 0) await Promise.allSettled([...pending]);
    return true;
  })();
  if (!Number.isFinite(limitMs)) return all;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), limitMs);
  });
  try {
    return await Promise.race([all, late]);
  } finally {
    clearTimeout(timer);
  }
}
