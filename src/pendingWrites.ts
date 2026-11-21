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

/** Resolves once every registered write has settled, those started meanwhile included; never rejects. */
export async function writesSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
