// ABOUTME: `bambu-hando 3dfp usage|spools`: the account's 3DFilamentProfiles spools and how many API calls are left.
// ABOUTME: usage never makes a call; spools makes at most one, reusing an hour-old list. Exit 2 for key or quota trouble.

import { parseArgs } from "node:util";

import { QuotaError, QuotaLedger, quotaPath, quotaReset, type QuotaState, utcMinute } from "./apiQuota.js";
import { errorMessage } from "./errors.js";
import { FilamentProfilesClient, FilamentProfilesError, type TdfpSpool } from "./filamentProfiles.js";
import { accountId, mySpools } from "./filamentProfilesCache.js";
import { loadSecret, SECRETS } from "./secrets.js";

interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const TDFP_USAGE = `Usage: bambu-hando 3dfp <usage|spools> [options]

Reads your 3DFilamentProfiles account with the API key from \`bambu-hando key set 3dfp\`
(or FILAMENTPROFILES_API_KEY). The API allows a monthly number of calls, so bambu-hando
counts them and reuses what it read.

  usage           How many API calls are left this month (makes no call)
  spools          Your spools: one call, or none while the last list is under an hour old

Options:
  --refresh       spools: fetch the list again even when it's fresh
  --json          spools: print snake_case JSON
  -h, --help      Show this help
`;

const OPTIONS = {
  refresh: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

class TdfpUsageError extends Error {}

function quotaLine(state: QuotaState, now: Date): string {
  const resets = `the quota resets ${utcMinute(quotaReset(now))}`;
  if (state.remaining === null || state.limit === null) return `3DFilamentProfiles API: calls left this month unknown until the first call; ${resets}.`;
  if (!state.exact) return `3DFilamentProfiles API: about ${state.remaining} of ${state.limit} calls left this month (estimated); ${resets}.`;
  const asOf = state.updatedAt ? ` (as of ${utcMinute(new Date(state.updatedAt))})` : "";
  return `3DFilamentProfiles API: ${state.remaining} of ${state.limit} calls left this month${asOf}; ${resets}.`;
}

function spoolName(spool: TdfpSpool): string {
  return [spool.brand, spool.material, spool.materialType, spool.color].filter(Boolean).join(" ");
}

function spoolLines(spools: TdfpSpool[]): string[] {
  const codeWidth = Math.max(0, ...spools.map((s) => s.shortCode.length));
  const nameWidth = Math.max(0, ...spools.map((s) => spoolName(s).length));
  const gramsWidth = Math.max(0, ...spools.map((s) => String(s.remainingGrams).length));
  return spools.map(
    (s) => `${s.shortCode.padEnd(codeWidth)}  ${spoolName(s).padEnd(nameWidth)}  ${String(s.remainingGrams).padStart(gramsWidth)} g  ${s.location ?? "-"}`,
  );
}

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeKeys = (record: object): Record<string, unknown> => Object.fromEntries(Object.entries(record).map(([key, value]) => [snakeCase(key), value]));

async function connect(): Promise<{ client: FilamentProfilesClient; ledger: QuotaLedger; account: string }> {
  const spec = SECRETS["3dfp"];
  const key = await loadSecret(spec);
  if (!key) throw new TdfpUsageError(`no ${spec.label}: run \`bambu-hando key set 3dfp\`, or set ${spec.env}`);
  const account = accountId(key.value);
  const ledger = new QuotaLedger(quotaPath(), account);
  return { client: new FilamentProfilesClient({ key: key.value, ledger }), ledger, account };
}

async function spoolsAction(refresh: boolean, json: boolean, io: Io): Promise<number> {
  const { client, ledger, account } = await connect();
  const result = await mySpools(client, { account, refresh });
  const quota = await ledger.current();
  const now = new Date();
  if (json) {
    const report = {
      fetched_at: result.fetchedAt.toISOString(),
      from_cache: result.fromCache,
      spools: result.spools.map(snakeKeys),
      quota: { limit: quota.limit, remaining: quota.remaining, exact: quota.exact, resets_at: quotaReset(now).toISOString() },
    };
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const count = `${result.spools.length} spool${result.spools.length === 1 ? "" : "s"}`;
  const left = quota.remaining === null || quota.limit === null ? "" : `; ${quota.exact ? "" : "about "}${quota.remaining} of ${quota.limit} left this month`;
  const footer = result.fromCache
    ? `${count} from the cache, fetched ${utcMinute(result.fetchedAt)} (no API call; --refresh fetches again)`
    : `${count} from 3DFilamentProfiles (1 API call${left})`;
  io.stdout(`${[...spoolLines(result.spools), footer].join("\n")}\n`);
  return 0;
}

export async function filamentProfilesCommand(argv: string[], io: Io): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    const [action, ...extra] = positionals;
    if (values.help || action === undefined) {
      io.stdout(TDFP_USAGE);
      return 0;
    }
    if (extra.length > 0) throw new TdfpUsageError(`unexpected argument after ${action}`);
    if (action === "spools") return await spoolsAction(values.refresh, values.json, io);
    if (action === "usage") {
      const { ledger } = await connect();
      io.stdout(`${quotaLine(await ledger.current(), new Date())}\n`);
      return 0;
    }
    throw new TdfpUsageError(`unknown action '${action}' (usage or spools)`);
  } catch (err) {
    if (err instanceof TdfpUsageError || (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"))) {
      io.stderr(`bambu-hando: error: ${err.message}\n\n${TDFP_USAGE}`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n`);
    const keyOrQuota = err instanceof QuotaError || (err instanceof FilamentProfilesError && (err.status === 401 || err.status === 402));
    return keyOrQuota ? 2 : 1;
  }
}
