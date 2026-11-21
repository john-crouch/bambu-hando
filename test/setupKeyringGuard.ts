// ABOUTME: Vitest setup file: wraps @napi-rs/keyring so in-process keyring calls only reach a private test keyring.
// ABOUTME: Anywhere else (any OS, any bus) they fail as an unreachable keyring would, so no test reads the login one.

import { vi } from "vitest";

vi.mock("@napi-rs/keyring", async (importOriginal) => {
  const real = await importOriginal<typeof import("@napi-rs/keyring")>();
  const { LOGIN_KEYRING_OFF_LIMITS, privateBusInUse } = await import("./keyringGuard.js");
  type Args = ConstructorParameters<typeof real.AsyncEntry>;

  /** AsyncEntry, made only when its call runs, and only on a private keyring's bus. */
  class AsyncEntry {
    readonly #args: Args;

    constructor(...args: Args) {
      this.#args = args;
    }

    #entry(): InstanceType<typeof real.AsyncEntry> {
      if (!privateBusInUse()) throw new Error(LOGIN_KEYRING_OFF_LIMITS);
      return new real.AsyncEntry(...this.#args);
    }

    async setPassword(password: string): Promise<void> {
      return this.#entry().setPassword(password);
    }

    async getPassword(): Promise<string | null> {
      return (await this.#entry().getPassword()) ?? null;
    }

    async deletePassword(): Promise<boolean> {
      return this.#entry().deletePassword();
    }
  }

  // Lets a test see the guard is in place before it makes a call that would otherwise reach a keyring.
  return { ...real, AsyncEntry, loginKeyringGuarded: true };
});
