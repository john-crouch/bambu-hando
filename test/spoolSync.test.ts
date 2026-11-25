// ABOUTME: Tests for planning and applying a SpoolEase ↔ 3DFilamentProfiles spool sync.
// ABOUTME: Covers the weight rule, matching unlinked spools, add suggestions, the user's choices, and applying within the quota.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QuotaLedger } from "../src/apiQuota.js";
import {
  FilamentProfilesClient,
  type TdfpFilament,
  type TdfpSpool,
} from "../src/filamentProfiles.js";
import type { SpoolRecord } from "../src/spoolease.js";
import type { SpoolLink } from "../src/spoolLinks.js";
import {
  addCandidates,
  applySync,
  planSync,
  SyncPlanError,
  type SyncRow,
  spoolsMatch,
  weightVerdict,
} from "../src/spoolSync.js";
import {
  type FilamentProfilesServer,
  serverFilament,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";

const NOW = new Date("2026-11-15T13:00:00Z");

/** A SpoolEase spool; currentWeight includes the 189 g core, so 753 means 564 g left. */
function sePool(overrides: Partial<SpoolRecord> = {}): SpoolRecord {
  return {
    id: "1",
    tagId: "04A1B2C3D4E5F6",
    material: "PETG",
    subtype: "",
    colorName: "2.0 Vivid Yellow",
    colorCodes: ["FFD700FF"],
    note: "",
    brand: "Sunlu",
    labelWeight: 1000,
    coreWeight: 189,
    fullWeight: null,
    currentWeight: 753,
    consumedSinceWeighed: 0,
    slicerFilament: "P4840583",
    addedTime: null,
    location: "",
    ...overrides,
  };
}

function tdSpool(overrides: Partial<TdfpSpool> = {}): TdfpSpool {
  return {
    shortCode: "ABC123",
    filamentId: 101,
    brand: "SUNLU",
    material: "PETG",
    materialType: "2.0",
    color: "Vivid Yellow",
    rgb: "#FFD700",
    remainingGrams: 1000,
    location: "Shelf",
    notes: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    url: "https://spooldb.com/s/ABC123",
    ...overrides,
  };
}

function filament(overrides: Partial<TdfpFilament> = {}): TdfpFilament {
  return {
    id: 101,
    brandKey: "sunlu",
    brandName: "SUNLU",
    materialKey: "petg",
    material: "PETG",
    materialTypeKey: "2-0",
    materialType: "2.0",
    color: "Vivid Yellow",
    rgb: "#FFD700",
    tdValue: null,
    discontinued: false,
    url: "",
    ...overrides,
  };
}

const link = (overrides: Partial<SpoolLink> = {}): SpoolLink => ({
  spoolease: "1",
  tdfp: "ABC123",
  agreed: { spoolease: 600, tdfp: 600 },
  tag: "04A1B2C3D4E5F6",
  linkedAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

const kinds = (rows: SyncRow[]) => rows.map((row) => row.kind);

describe("weightVerdict", () => {
  const agreed = { spoolease: 600, tdfp: 600 };

  it("does nothing while the sides are within 5 g", () => {
    expect(weightVerdict(agreed, 598, 602)).toEqual({ kind: "agree" });
    expect(weightVerdict(null, 1000, 996)).toEqual({ kind: "agree" });
  });

  it("can't compare a spool SpoolEase hasn't weighed", () => {
    expect(weightVerdict(agreed, null, 600)).toEqual({ kind: "unweighed" });
  });

  it("pushes SpoolEase's weight when only SpoolEase changed, up or down", () => {
    expect(weightVerdict(agreed, 540, 600)).toEqual({ kind: "push", grams: 540 });
    expect(weightVerdict(agreed, 640, 600)).toEqual({ kind: "push", grams: 640 });
  });

  it("asks for a weigh when only 3DFP changed, since SpoolEase's weight can't be written", () => {
    expect(weightVerdict(agreed, 600, 500)).toEqual({ kind: "weigh" });
    expect(weightVerdict(agreed, 600, 900)).toEqual({ kind: "weigh" });
  });

  it("lets the lower weight win when both changed", () => {
    expect(weightVerdict(agreed, 450, 500)).toEqual({ kind: "push", grams: 450 });
    expect(weightVerdict(agreed, 500, 450)).toEqual({ kind: "weigh" });
  });

  it("trusts SpoolEase's scale on a first comparison, lower or higher", () => {
    expect(weightVerdict(null, 564, 1000)).toEqual({ kind: "push", grams: 564 });
    expect(weightVerdict(null, 900, 700)).toEqual({ kind: "push", grams: 900 });
    expect(weightVerdict(null, 800, 0)).toEqual({ kind: "push", grams: 800 });
  });

  it("keeps asking while an unresolved difference stays", () => {
    // Only 3DFP went down; nothing was agreed since, and SpoolEase then printed a little.
    expect(weightVerdict(agreed, 590, 500)).toEqual({ kind: "weigh" });
  });

  it("never pushes more than the API takes", () => {
    expect(weightVerdict(null, 12_000, 10_000)).toEqual({ kind: "agree" });
  });
});

describe("spoolsMatch", () => {
  it("matches brand, material and color, ignoring case, spaces and punctuation", () => {
    expect(spoolsMatch(sePool(), tdSpool())).toBe(true);
    expect(spoolsMatch(sePool({ colorName: "Vivid Yellow", subtype: "2.0" }), tdSpool())).toBe(
      true,
    );
    expect(
      spoolsMatch(
        sePool({ colorName: "Mildewed Red", material: "PETG", subtype: "Elite" }),
        tdSpool({ materialType: "Basic Elite", color: "Mildewed Red" }),
      ),
    ).toBe(true);
  });

  it("needs all three to agree", () => {
    expect(spoolsMatch(sePool({ brand: "eSUN" }), tdSpool())).toBe(false);
    expect(spoolsMatch(sePool({ material: "PLA" }), tdSpool())).toBe(false);
    expect(spoolsMatch(sePool({ colorName: "Wine Red" }), tdSpool())).toBe(false);
    expect(spoolsMatch(sePool(), tdSpool({ color: "" }))).toBe(false);
  });

  it("takes extra words on SpoolEase's side, such as the product line, only when the colors agree", () => {
    // SpoolmanDB product names carry the line; 3DFP's spool list often has no material type.
    const bare = (rgb: string | null) =>
      tdSpool({ materialType: null, color: "Vivid Yellow", rgb });
    expect(spoolsMatch(sePool(), bare("#FFD700"))).toBe(true);
    expect(spoolsMatch(sePool(), bare("#F0C810"))).toBe(true);
    expect(spoolsMatch(sePool(), bare("#3050C0"))).toBe(false);
    expect(spoolsMatch(sePool(), bare(null))).toBe(false);
  });

  it("doesn't take a plain color for a variant of it", () => {
    const pair = (ours: string, code: string, theirs: string, rgb: string) =>
      spoolsMatch(
        sePool({ colorName: ours, colorCodes: [code] }),
        tdSpool({ materialType: null, color: theirs, rgb }),
      );
    // The extra word is on 3DFP's side, whatever the colors.
    expect(pair("Black", "000000FF", "Matte Black", "#000000")).toBe(false);
    expect(pair("Red", "FF0000FF", "Dark Red", "#FF0000")).toBe(false);
    // On SpoolEase's side, but the colors differ.
    expect(pair("Light Blue", "ADD8E6FF", "Blue", "#0000FF")).toBe(false);
    expect(pair("Matte Black", "2B2B2BFF", "Black", "#000000")).toBe(false);
    // The extra word is the other side's material type, so it's the same color.
    expect(
      spoolsMatch(
        sePool({ colorName: "Matte Black", colorCodes: ["000000FF"] }),
        tdSpool({ materialType: "Matte", color: "Black", rgb: null }),
      ),
    ).toBe(true);
  });
});

describe("addCandidates", () => {
  it("keeps catalog filaments of the spool's brand, material and color", () => {
    const fits = filament();
    const found = addCandidates(sePool(), [
      filament({ id: 2, color: "Black" }),
      fits,
      filament({ id: 3, material: "PLA", materialKey: "pla" }),
      filament({ id: 4, brandName: "eSUN", brandKey: "esun" }),
    ]);
    expect(found).toEqual([fits]);
  });

  it("leaves out variants of the spool's color, and keeps the product line when the colors agree", () => {
    const black = sePool({ colorName: "Black", colorCodes: ["000000FF"] });
    expect(
      addCandidates(black, [
        filament({ color: "Matte Black", materialType: null, rgb: "#000000" }),
      ]),
    ).toEqual([]);
    const bare = filament({ color: "Vivid Yellow", materialType: null, rgb: "#FFD700" });
    expect(
      addCandidates(sePool(), [
        bare,
        filament({ id: 9, color: "Vivid Yellow", materialType: null, rgb: "#3050C0" }),
      ]),
    ).toEqual([bare]);
  });
});

describe("planSync", () => {
  const plan = (input: Partial<Parameters<typeof planSync>[0]> = {}) =>
    planSync({
      spoolease: [sePool()],
      tdfp: [tdSpool()],
      links: [],
      now: NOW,
      filamentsFor: () => [],
      ...input,
    });

  it("links a spool that matches exactly one on the other side, pushing the lower weight and the tag", () => {
    const result = plan();
    expect(result.rows).toEqual([
      {
        kind: "linked",
        how: "matched",
        spool: sePool(),
        tdfp: tdSpool(),
        before: null,
        after: {
          spoolease: "1",
          tdfp: "ABC123",
          agreed: { spoolease: 564, tdfp: 564 },
          tag: "04A1B2C3D4E5F6",
          linkedAt: NOW.toISOString(),
        },
        weight: { kind: "push", grams: 564 },
        patch: { remainingGrams: 564, bambuTagId: "04A1B2C3D4E5F6" },
      },
    ]);
    expect(result).toMatchObject({ calls: 1, changes: 1 });
  });

  it("sends nothing for a linked pair in step whose tag is written", () => {
    const result = plan({
      spoolease: [sePool({ currentWeight: 789 })],
      links: [link()],
      tdfp: [tdSpool({ remainingGrams: 600 })],
    });
    expect(result.rows[0]).toMatchObject({
      kind: "linked",
      how: "kept",
      weight: { kind: "agree" },
      patch: null,
    });
    expect(result).toMatchObject({ calls: 0, changes: 0 });
  });

  it("remembers the new agreement without a call when both moved to the same weight", () => {
    const result = plan({ links: [link()], tdfp: [tdSpool({ remainingGrams: 565 })] });
    expect(result.rows[0]).toMatchObject({
      weight: { kind: "agree" },
      patch: null,
      after: { agreed: { spoolease: 564, tdfp: 565 } },
    });
    expect(result.calls).toBe(0);
  });

  it("keeps the last agreement while asking for a weigh", () => {
    const result = plan({
      spoolease: [sePool({ currentWeight: 789 })],
      links: [link()],
      tdfp: [tdSpool({ remainingGrams: 500 })],
    });
    expect(result.rows[0]).toMatchObject({
      weight: { kind: "weigh" },
      patch: null,
      after: { agreed: { spoolease: 600, tdfp: 600 } },
    });
  });

  it("writes the tag again when SpoolEase's changed, and only the tag when weights agree", () => {
    const result = plan({
      spoolease: [sePool({ currentWeight: 789, tagId: "04FFFFFFFFFFFF" })],
      links: [link()],
      tdfp: [tdSpool({ remainingGrams: 600 })],
    });
    expect(result.rows[0]).toMatchObject({
      patch: { bambuTagId: "04FFFFFFFFFFFF" },
      after: { tag: "04FFFFFFFFFFFF" },
    });
    expect(result).toMatchObject({ calls: 1, changes: 1 });
  });

  it("leaves 3DFP's tag alone when the SpoolEase spool has none", () => {
    const result = plan({ spoolease: [sePool({ tagId: "" })] });
    expect(result.rows[0]).toMatchObject({ patch: { remainingGrams: 564 }, after: { tag: null } });
  });

  it("drops a link whose spool is gone on either side", () => {
    const result = plan({
      spoolease: [],
      tdfp: [tdSpool({ shortCode: "OTHER1", color: "Black" })],
      links: [link()],
    });
    expect(result.rows).toEqual([
      {
        kind: "unlinked",
        link: link(),
        spool: null,
        tdfp: null,
        reason: "spoolease-gone",
        patch: null,
      },
      { kind: "tdfp-only", tdfp: tdSpool({ shortCode: "OTHER1", color: "Black" }) },
    ]);
    expect(plan({ tdfp: [], links: [link()] }).rows[0]).toMatchObject({
      kind: "unlinked",
      reason: "tdfp-gone",
    });
  });

  it("asks which spool when several match, and matches none of them", () => {
    const twins = [tdSpool(), tdSpool({ shortCode: "DEF456" })];
    const result = plan({ tdfp: twins });
    expect(result.rows).toEqual([{ kind: "ambiguous", spool: sePool(), candidates: twins }]);
    expect(result.calls).toBe(0);
  });

  it("doesn't match a 3DFP spool that several SpoolEase spools fit", () => {
    const result = plan({ spoolease: [sePool(), sePool({ id: "2", tagId: "" })] });
    expect(kinds(result.rows)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("offers to add a SpoolEase spool to 3DFP when exactly one catalog filament fits", () => {
    const result = plan({
      tdfp: [],
      filamentsFor: () => [filament({ id: 9, color: "Black" }), filament()],
    });
    expect(result.rows).toEqual([
      {
        kind: "add",
        spool: sePool(),
        chosen: false,
        filamentId: 101,
        filament: filament(),
        grams: 564,
        tag: "04A1B2C3D4E5F6",
      },
    ]);
    expect(result).toMatchObject({ calls: 1, changes: 1 });
  });

  it("adds an unweighed spool at the filament's own weight, and without a tag", () => {
    const result = plan({
      spoolease: [sePool({ currentWeight: null, tagId: "" })],
      tdfp: [],
      filamentsFor: () => [filament()],
    });
    expect(result.rows[0]).toMatchObject({ kind: "add", grams: null, tag: null });
    expect(result.calls).toBe(1);
  });

  it("lists the fitting filaments when there are none or several", () => {
    const several = [filament(), filament({ id: 102 })];
    expect(plan({ tdfp: [], filamentsFor: () => several }).rows).toEqual([
      { kind: "suggest", spool: sePool(), filaments: several },
    ]);
    expect(plan({ tdfp: [] }).rows).toEqual([{ kind: "suggest", spool: sePool(), filaments: [] }]);
  });

  it("lists 3DFP spools nothing on SpoolEase matches", () => {
    const result = plan({
      tdfp: [tdSpool(), tdSpool({ shortCode: "ZZZ999", brand: "eSUN", color: "Light Khaki" })],
    });
    expect(kinds(result.rows)).toEqual(["linked", "tdfp-only"]);
  });

  describe("external IDs", () => {
    it("writes the SpoolEase spool's ID into a new link's 3DFP spool", () => {
      const result = plan({ tdfp: [tdSpool({ externalId: null })] });
      expect(result.rows[0]).toMatchObject({
        kind: "linked",
        patch: { remainingGrams: 564, bambuTagId: "04A1B2C3D4E5F6", externalId: "spoolease:1" },
      });
      expect(result.calls).toBe(1);
    });

    it("fixes an ID that names another SpoolEase spool, and leaves a right one alone", () => {
      const pair = {
        spoolease: [sePool({ currentWeight: 789 })],
        links: [link()],
      };
      expect(
        plan({ ...pair, tdfp: [tdSpool({ remainingGrams: 600, externalId: "spoolease:7" })] })
          .rows[0],
      ).toMatchObject({ patch: { externalId: "spoolease:1" } });
      expect(
        plan({ ...pair, tdfp: [tdSpool({ remainingGrams: 600, externalId: "spoolease:1" })] })
          .rows[0],
      ).toMatchObject({ patch: null });
    });

    it("never overwrites an ID another app keeps, nor writes one it hasn't read", () => {
      const pair = { spoolease: [sePool({ currentWeight: 789 })], links: [link()] };
      for (const tdfp of [
        tdSpool({ remainingGrams: 600, externalId: "inventree-42" }),
        tdSpool({ remainingGrams: 600 }),
      ])
        expect(plan({ ...pair, tdfp: [tdfp] }).rows[0]).toMatchObject({ patch: null });
    });

    it("rebuilds a lost link from the ID 3DFP keeps, even when the colors are named apart", () => {
      const result = plan({
        tdfp: [
          tdSpool({ color: "Sunflower", externalId: "spoolease:1" }),
          tdSpool({ shortCode: "DEF456", externalId: null }),
        ],
      });
      expect(result.rows[0]).toMatchObject({
        kind: "linked",
        how: "recorded",
        tdfp: { shortCode: "ABC123" },
        before: null,
      });
      expect(result.rows[1]).toMatchObject({ kind: "tdfp-only", tdfp: { shortCode: "DEF456" } });
    });

    it("doesn't trust an ID whose brand or material disagrees (another console's spool #1)", () => {
      const result = plan({
        tdfp: [tdSpool({ brand: "eSUN", color: "Black", externalId: "spoolease:1" })],
      });
      expect(kinds(result.rows)).toEqual(["suggest", "tdfp-only"]);
    });

    it("clears the ID on 3DFP when a link goes, so the next sync doesn't bring it back", () => {
      const asked = plan({
        links: [link()],
        tdfp: [tdSpool({ externalId: "spoolease:1" })],
        choices: { unlink: new Set(["1"]) },
      });
      expect(asked.rows[0]).toMatchObject({
        kind: "unlinked",
        reason: "asked",
        tdfp: { shortCode: "ABC123" },
        patch: { externalId: null },
      });
      expect(asked.calls).toBe(1);

      const gone = plan({
        spoolease: [],
        links: [link()],
        tdfp: [tdSpool({ externalId: "spoolease:1" })],
      });
      expect(gone.rows[0]).toMatchObject({ reason: "spoolease-gone", patch: { externalId: null } });

      const elsewhere = plan({
        spoolease: [],
        links: [link()],
        tdfp: [tdSpool({ externalId: "inventree-42" })],
      });
      expect(elsewhere.rows[0]).toMatchObject({ kind: "unlinked", patch: null });
    });
  });

  describe("choices", () => {
    it("links the pair given, whatever the names say", () => {
      const result = plan({
        tdfp: [tdSpool({ color: "Wine Red" })],
        choices: { link: new Map([["1", "ABC123"]]) },
      });
      expect(result.rows[0]).toMatchObject({
        kind: "linked",
        how: "chosen",
        patch: { remainingGrams: 564 },
      });
    });

    it("replaces the links a chosen pair takes over", () => {
      const result = plan({
        spoolease: [sePool(), sePool({ id: "2", colorName: "Black" })],
        tdfp: [tdSpool(), tdSpool({ shortCode: "DEF456", color: "Black" })],
        links: [link(), link({ spoolease: "2", tdfp: "DEF456" })],
        choices: { link: new Map([["1", "DEF456"]]) },
      });
      expect(result.rows.filter((row) => row.kind === "unlinked")).toMatchObject([
        { link: { spoolease: "1", tdfp: "ABC123" }, reason: "replaced" },
        { link: { spoolease: "2", tdfp: "DEF456" }, reason: "replaced" },
      ]);
      expect(result.rows.find((row) => row.kind === "linked")).toMatchObject({
        how: "chosen",
        after: { spoolease: "1", tdfp: "DEF456", agreed: { spoolease: 564, tdfp: 564 } },
      });
    });

    it("unlinks when asked, leaving the SpoolEase spool out of matching and adding for that run", () => {
      const result = plan({
        links: [link()],
        choices: { unlink: new Set(["1"]) },
        filamentsFor: () => [filament()],
      });
      expect(kinds(result.rows)).toEqual(["unlinked", "tdfp-only"]);
      expect(result.rows[0]).toMatchObject({ reason: "asked" });
      expect(result.changes).toBe(1);
    });

    it("adds as the filament given", () => {
      const result = plan({
        tdfp: [],
        choices: { add: new Map([["1", 555]]) },
        filamentsFor: () => [filament()],
      });
      expect(result.rows[0]).toMatchObject({
        kind: "add",
        chosen: true,
        filamentId: 555,
        filament: null,
      });
    });

    it("refuses choices that don't fit the spools", () => {
      expect(() => plan({ choices: { link: new Map([["9", "ABC123"]]) } })).toThrow(
        new SyncPlanError("SpoolEase has no spool #9"),
      );
      expect(() => plan({ choices: { link: new Map([["1", "NOPE"]]) } })).toThrow(
        new SyncPlanError("3DFilamentProfiles has no spool NOPE"),
      );
      expect(() =>
        plan({
          spoolease: [sePool(), sePool({ id: "2" })],
          choices: {
            link: new Map([
              ["1", "ABC123"],
              ["2", "ABC123"],
            ]),
          },
        }),
      ).toThrow(
        new SyncPlanError(
          "3DFilamentProfiles spool ABC123 can't be linked to two SpoolEase spools",
        ),
      );
      expect(() => plan({ choices: { add: new Map([["9", 101]]) } })).toThrow(
        new SyncPlanError("SpoolEase has no spool #9"),
      );
      expect(() =>
        plan({ choices: { link: new Map([["1", "ABC123"]]), add: new Map([["1", 101]]) } }),
      ).toThrow(new SyncPlanError("#1 can't be both linked and added"));
      expect(() => plan({ links: [link()], choices: { add: new Map([["1", 101]]) } })).toThrow(
        new SyncPlanError("#1 is already linked to ABC123: --unlink 1 first"),
      );
      expect(() => plan({ choices: { unlink: new Set(["1"]) } })).toThrow(
        new SyncPlanError("#1 isn't linked"),
      );
    });
  });
});

describe("applySync", () => {
  let server: FilamentProfilesServer;
  let client: FilamentProfilesClient;

  beforeEach(async () => {
    server = await startFilamentProfilesServer();
    server.filaments = [serverFilament()];
    server.spools = [serverSpool({ remaining_grams: 1000 })];
    const dir = await mkdtemp(join(tmpdir(), "bh-spool-sync-"));
    client = new FilamentProfilesClient({
      key: TEST_API_KEY,
      base: server.url,
      ledger: new QuotaLedger(join(dir, "quota.json"), "acct1"),
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const listed = async () => (await client.listSpools()).spools;

  it("sends a new link's weight and tag in one bulk update and returns the links to keep", async () => {
    const tdfp = await listed();
    const plan = planSync({
      spoolease: [sePool()],
      tdfp,
      links: [],
      now: NOW,
      filamentsFor: () => [],
    });
    const before = server.requests.length;
    const result = await applySync(plan, client);
    expect(server.requests.slice(before).map((r) => [r.method, r.path, r.body])).toEqual([
      [
        "PATCH",
        "/api/v1/my/spools",
        [
          {
            short_code: "ABC123",
            remaining_grams: 564,
            bambu_tag_id: "04A1B2C3D4E5F6",
            external_id: "spoolease:1",
          },
        ],
      ],
    ]);
    expect(result).toMatchObject({ calls: 1, outcomes: [{ ok: true, error: null }] });
    expect(server.spools[0]?.external_id).toBe("spoolease:1");
    expect(result.links).toEqual([
      {
        spoolease: "1",
        tdfp: "ABC123",
        agreed: { spoolease: 564, tdfp: 564 },
        tag: "04A1B2C3D4E5F6",
        linkedAt: NOW.toISOString(),
      },
    ]);
    expect(server.spools[0]).toMatchObject({
      remaining_grams: 564,
      bambu_tag_id: "04A1B2C3D4E5F6",
    });
  });

  it("adds a spool with its tag in one call, and links it", async () => {
    server.spools = [];
    const plan = planSync({
      spoolease: [sePool()],
      tdfp: [],
      links: [],
      now: NOW,
      filamentsFor: () => [filament()],
    });
    const result = await applySync(plan, client);
    expect(server.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      [
        "POST",
        "/api/v1/my/spools",
        {
          filament_id: 101,
          remaining_grams: 564,
          bambu_tag_id: "04A1B2C3D4E5F6",
          external_id: "spoolease:1",
        },
      ],
    ]);
    expect(result).toMatchObject({ calls: 1, outcomes: [{ ok: true, created: "NEW001" }] });
    expect(server.spools[0]?.bambu_tag_id).toBe("04A1B2C3D4E5F6");
    expect(result.links).toEqual([
      {
        spoolease: "1",
        tdfp: "NEW001",
        agreed: { spoolease: 564, tdfp: 564 },
        tag: "04A1B2C3D4E5F6",
        linkedAt: NOW.toISOString(),
      },
    ]);
  });

  it("keeps a new link without the unsent changes when its update fails, and goes on", async () => {
    server.spools = [
      serverSpool({ remaining_grams: 1000 }),
      serverSpool({ short_code: "DEF456", color: "Black", remaining_grams: 1000 }),
    ];
    const tdfp = await listed();
    server.replies["PATCH /api/v1/my/spools"] = {
      status: 200,
      body: {
        data: [
          {
            short_code: "ABC123",
            error: { code: "internal", message: "An unexpected error occurred" },
          },
          { short_code: "DEF456", remaining_grams: 564, deducted_grams: 0, location: "Shelf A" },
        ],
      },
    };
    const plan = planSync({
      spoolease: [sePool(), sePool({ id: "2", colorName: "Black", tagId: "" })],
      tdfp,
      links: [],
      now: NOW,
      filamentsFor: () => [],
    });
    const result = await applySync(plan, client);
    expect(result.outcomes.map((o) => o.error)).toEqual([
      "3DFilamentProfiles: An unexpected error occurred (internal)",
      null,
    ]);
    expect(result.links).toEqual([
      { spoolease: "1", tdfp: "ABC123", agreed: null, tag: null, linkedAt: NOW.toISOString() },
      {
        spoolease: "2",
        tdfp: "DEF456",
        agreed: { spoolease: 564, tdfp: 564 },
        tag: null,
        linkedAt: NOW.toISOString(),
      },
    ]);
  });

  it("keeps a new link, without its changes, when 3DFP no longer has the spool", async () => {
    server.spools = [];
    const plan = planSync({
      spoolease: [sePool()],
      tdfp: [tdSpool()],
      links: [],
      now: NOW,
      filamentsFor: () => [],
    });
    const result = await applySync(plan, client);
    expect(result.outcomes[0]?.error).toBe("3DFilamentProfiles: Spool not found (not_found)");
    expect(result.links).toEqual([
      { spoolease: "1", tdfp: "ABC123", agreed: null, tag: null, linkedAt: NOW.toISOString() },
    ]);
  });

  it("fails every spool in a bulk update the API refused as a whole", async () => {
    server.spools = [
      serverSpool({ remaining_grams: 1000 }),
      serverSpool({ short_code: "DEF456", color: "Black", remaining_grams: 1000 }),
    ];
    const tdfp = await listed();
    server.replies["PATCH /api/v1/my/spools"] = {
      status: 500,
      body: { error: { code: "internal", message: "An unexpected error occurred" } },
    };
    const plan = planSync({
      spoolease: [sePool(), sePool({ id: "2", colorName: "Black", tagId: "" })],
      tdfp,
      links: [],
      now: NOW,
      filamentsFor: () => [],
    });
    const result = await applySync(plan, client);
    expect(result.outcomes.map((o) => o.error)).toEqual([
      "3DFilamentProfiles: An unexpected error occurred (internal)",
      "3DFilamentProfiles: An unexpected error occurred (internal)",
    ]);
    expect(result.links.map((l) => l.agreed)).toEqual([null, null]);
  });

  it("sends up to 50 updates per call", async () => {
    const count = 51;
    const codes = Array.from({ length: count }, (_, i) => `S${String(i).padStart(3, "0")}`);
    server.spools = codes.map((code) => serverSpool({ short_code: code, remaining_grams: 1000 }));
    const plan = planSync({
      spoolease: codes.map((_, i) => sePool({ id: String(i + 1), tagId: "" })),
      tdfp: codes.map((code) => tdSpool({ shortCode: code, remainingGrams: 1000 })),
      links: codes.map((code, i) => link({ spoolease: String(i + 1), tdfp: code, tag: null })),
      now: NOW,
      filamentsFor: () => [],
    });
    expect(plan.calls).toBe(2);
    const result = await applySync(plan, client);
    expect(server.requests.map((r) => (r.body as unknown[]).length)).toEqual([50, 1]);
    expect(result.calls).toBe(2);
    expect(result.outcomes).toHaveLength(count);
    expect(result.outcomes.every((o) => o.ok)).toBe(true);
    expect(server.spools.every((s) => s.remaining_grams === 564)).toBe(true);
  });

  it("stops calling once the quota runs out, keeping what's unsent for next time", async () => {
    server.spools = [serverSpool({ remaining_grams: 1000 })];
    const tdfp = await listed();
    server.quota.remaining = 1;
    const plan = planSync({
      spoolease: [sePool(), sePool({ id: "2", colorName: "Black" })],
      tdfp,
      links: [],
      now: NOW,
      filamentsFor: (spool) =>
        spool.colorName === "Black" ? [filament({ id: 102, color: "Black", rgb: null })] : [],
    });
    expect(plan.rows.map((row) => row.kind)).toEqual(["linked", "add"]);
    const before = server.requests.length;
    const result = await applySync(plan, client);
    expect(server.requests.length - before).toBe(1);
    expect(result.calls).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ ok: true });
    expect(result.outcomes[1]?.error).toMatch(/quota is used up/);
  });

  it("clears a dropped link's ID on 3DFP in the same bulk update", async () => {
    server.spools = [serverSpool({ external_id: "spoolease:1" })];
    const tdfp = await listed();
    const plan = planSync({
      spoolease: [sePool()],
      tdfp,
      links: [link()],
      choices: { unlink: new Set(["1"]) },
      now: NOW,
      filamentsFor: () => [],
    });
    const before = server.requests.length;
    const result = await applySync(plan, client);
    expect(server.requests.slice(before).map((r) => r.body)).toEqual([
      [{ short_code: "ABC123", external_id: null }],
    ]);
    expect(result).toMatchObject({ links: [], outcomes: [{ ok: true }], calls: 1 });
    expect(server.spools[0]?.external_id).toBeNull();
  });

  it("drops unlinked pairs and keeps links that needed nothing", async () => {
    const plan = planSync({
      spoolease: [sePool({ currentWeight: 789 })],
      tdfp: [tdSpool({ remainingGrams: 600 })],
      links: [link(), link({ spoolease: "5", tdfp: "GONE01" })],
      now: NOW,
      filamentsFor: () => [],
    });
    const result = await applySync(plan, client);
    expect(server.requests).toHaveLength(0);
    expect(result.links).toEqual([link()]);
  });
});
