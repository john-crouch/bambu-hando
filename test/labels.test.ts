// ABOUTME: Unit tests for spool label content: size and field parsing, SpoolEase spool links, and label lines.
// ABOUTME: Covers everything a label shows before it is drawn into a PDF.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LABEL_FIELDS,
  filterSpools,
  labelContent,
  parseLabelFields,
  parseLabelSize,
  spoolTagUrl,
} from "../src/labels.js";
import type { CustomFilament, SpoolRecord } from "../src/spoolease.js";

function spool(overrides: Partial<SpoolRecord> = {}): SpoolRecord {
  return {
    id: "1",
    tagId: "04A1B2C3D4E5F6",
    material: "PETG",
    subtype: "",
    colorName: "2.0 Vivid Yellow",
    colorCodes: ["F1C400FF"],
    note: "",
    brand: "Sunlu",
    labelWeight: 1000,
    coreWeight: 189,
    fullWeight: null,
    slicerFilament: "P4840583",
    addedTime: null,
    location: "",
    ...overrides,
  };
}

const filaments = new Map<string, CustomFilament>([["P4840583", { name: "Sunlu PETG 2.0 Vivid Yellow", nozzleTempMin: 230, nozzleTempMax: 250 }]]);

describe("parseLabelSize", () => {
  it("reads inches by default and converts to PDF points", () => {
    expect(parseLabelSize("2.5x1.5")).toEqual({ width: 180, height: 108, media: "Custom.2.5x1.5in" });
    expect(parseLabelSize("2.5x1.5in")).toEqual({ width: 180, height: 108, media: "Custom.2.5x1.5in" });
  });

  it("reads millimeters", () => {
    const size = parseLabelSize("40x30mm");
    expect(size.media).toBe("Custom.40x30mm");
    expect(size.width).toBeCloseTo(113.386, 3);
    expect(size.height).toBeCloseTo(85.039, 3);
  });

  it("rejects sizes it can't read", () => {
    for (const bad of ["", "2.5", "2.5x", "0x1in", "2.5x1.5cm", "axb"]) {
      expect(() => parseLabelSize(bad)).toThrow(`label size must look like 2.5x1.5in or 40x30mm, got "${bad}"`);
    }
  });
});

describe("parseLabelFields", () => {
  it("keeps the fields in label order, whatever order they are given in", () => {
    expect(parseLabelFields("id, color,qr,brand")).toEqual(["qr", "brand", "color", "id"]);
  });

  it("rejects unknown and empty field lists", () => {
    expect(() => parseLabelFields("brand,price")).toThrow('unknown label field "price"; fields: qr, brand, material, name, color, hex, temps, weight, empty, code, location, added, note, id');
    expect(() => parseLabelFields(" , ")).toThrow("no label fields given");
  });

  it("defaults to the fields that identify a spool at a glance", () => {
    expect(DEFAULT_LABEL_FIELDS).toEqual(["qr", "brand", "material", "color", "temps", "weight", "id"]);
  });
});

describe("spoolTagUrl", () => {
  it("builds SpoolEase's own S1 spool link, without a tag id since a label has no NFC tag", () => {
    expect(spoolTagUrl(spool())).toBe("https://tag.spoolease.io/S1/?ID=1&M=PETG&CC=F1C400FF&CN=2%2E0%20Vivid%20Yellow&B=Sunlu&WL=1000&WE=189&SC=P4840583");
  });

  it("leaves out zero weights, as SpoolEase leaves out every value equal to its default", () => {
    expect(spoolTagUrl(spool({ fullWeight: 0, coreWeight: 0 }))).toBe(
      "https://tag.spoolease.io/S1/?ID=1&M=PETG&CC=F1C400FF&CN=2%2E0%20Vivid%20Yellow&B=Sunlu&WL=1000&SC=P4840583",
    );
  });

  it("percent-encodes everything but letters, digits and the color separator, like SpoolEase", () => {
    const url = spoolTagUrl(
      spool({
        brand: "Polymaker",
        material: "PLA",
        subtype: "Silk+",
        colorName: "Gold™",
        colorCodes: ["D4AF37FF", "C0C0C0FF"],
        coreWeight: null,
        fullWeight: 1140,
        addedTime: 1761955200,
      }),
    );
    expect(url).toBe("https://tag.spoolease.io/S1/?ID=1&DA=1761955200&M=PLA&MS=Silk%2B&CC=D4AF37FF;C0C0C0FF&CN=Gold%E2%84%A2&B=Polymaker&WL=1000&WF=1140&SC=P4840583");
  });
});

describe("labelContent", () => {
  it("shows the chosen fields, with the QR code holding the spool link", () => {
    expect(labelContent(spool(), filaments, DEFAULT_LABEL_FIELDS)).toEqual({
      qr: spoolTagUrl(spool()),
      lines: [
        { field: "brand", text: "Sunlu", style: "title" },
        { field: "material", text: "PETG", style: "strong" },
        { field: "color", text: "2.0 Vivid Yellow", style: "normal" },
        { field: "temps", text: "230–250 °C", style: "normal" },
        { field: "weight", text: "1000 g", style: "normal" },
        { field: "id", text: "Spool #1", style: "small" },
      ],
    });
  });

  it("formats every optional field", () => {
    const record = spool({ subtype: "HF", colorCodes: ["F1C400FF", "000000FF"], note: "Dry first", location: "Shelf A", addedTime: 1761955200 });
    const fields = parseLabelFields("name,material,hex,empty,code,location,added,note");

    expect(labelContent(record, filaments, fields)).toEqual({
      qr: null,
      lines: [
        { field: "material", text: "PETG HF", style: "strong" },
        { field: "name", text: "Sunlu PETG 2.0 Vivid Yellow", style: "normal" },
        { field: "hex", text: "#F1C400 / #000000", style: "normal" },
        { field: "empty", text: "Empty 189 g", style: "normal" },
        { field: "code", text: "P4840583", style: "small" },
        { field: "location", text: "Shelf A", style: "normal" },
        { field: "added", text: "Added 2025-11-01", style: "small" },
        { field: "note", text: "Dry first", style: "small" },
      ],
    });
  });

  it("leaves out fields the spool has no value for", () => {
    const record = spool({ slicerFilament: "GFL99", labelWeight: null, coreWeight: null, colorName: "" });
    const fields = parseLabelFields("color,name,temps,weight,empty,location,added,note,id");

    expect(labelContent(record, filaments, fields).lines).toEqual([{ field: "id", text: "Spool #1", style: "small" }]);
  });
});

describe("filterSpools", () => {
  const spools = [
    spool(),
    spool({ id: "2", brand: "Polymaker", material: "PLA", colorName: "Black", slicerFilament: "Pabcdef0" }),
    spool({ id: "3", brand: "polymaker", material: "PETG", colorName: "Galaxy Black", slicerFilament: "" }),
  ];

  it("selects spools by id, in the order given", () => {
    expect(filterSpools(spools, filaments, { ids: ["3", "1"], brand: "", material: "", match: "" }).map((s) => s.id)).toEqual(["3", "1"]);
  });

  it("filters by brand and material ignoring case, and by words in the spool's description", () => {
    const pick = (filters: { brand?: string; material?: string; match?: string }) =>
      filterSpools(spools, filaments, { ids: [], brand: "", material: "", match: "", ...filters }).map((s) => s.id);

    expect(pick({ brand: "POLYMAKER" })).toEqual(["2", "3"]);
    expect(pick({ brand: "polymaker", material: "petg" })).toEqual(["3"]);
    expect(pick({ match: "black" })).toEqual(["2", "3"]);
    expect(pick({ match: "vivid petg" })).toEqual(["1"]);
    expect(pick({})).toEqual(["1", "2", "3"]);
  });

  it("throws for ids SpoolEase doesn't have", () => {
    expect(() => filterSpools(spools, filaments, { ids: ["1", "9", "12"], brand: "", material: "", match: "" })).toThrow("SpoolEase has no spool with ID 9, 12");
  });
});
