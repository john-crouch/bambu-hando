// ABOUTME: Opens the 3DFilamentProfiles client with the stored API key and that account's quota ledger.
// ABOUTME: Shared by every `bambu-hando 3dfp` action; MissingKeyError says how to store a key.

import { QuotaLedger, quotaPath } from "./apiQuota.js";
import { FilamentProfilesClient } from "./filamentProfiles.js";
import { accountId } from "./filamentProfilesCache.js";
import { InvalidSecretError, loadSecret, SECRETS } from "./secrets.js";

export class MissingKeyError extends Error {}

export interface FilamentProfilesConnection {
  client: FilamentProfilesClient;
  ledger: QuotaLedger;
  /** accountId of the key. */
  account: string;
}

export async function connectFilamentProfiles(): Promise<FilamentProfilesConnection> {
  const spec = SECRETS["3dfp"];
  let key;
  try {
    key = await loadSecret(spec);
  } catch (err) {
    // An unusable key is as much a setup problem as a missing one.
    throw err instanceof InvalidSecretError ? new MissingKeyError(err.message) : err;
  }
  if (!key)
    throw new MissingKeyError(
      `no ${spec.label}: run \`bambu-hando key set 3dfp\`, or set ${spec.env}`,
    );
  const account = accountId(key.value);
  const ledger = new QuotaLedger(quotaPath(), account);
  return { client: new FilamentProfilesClient({ key: key.value, ledger }), ledger, account };
}
