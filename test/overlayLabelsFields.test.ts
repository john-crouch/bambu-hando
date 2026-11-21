// ABOUTME: Tests for the label fields' display names: one name per field, shared by the labels dialog and Settings.
// ABOUTME: Checks every field has a short sentence-case name and the joined list reads as one sentence.

import { describe, expect, it } from "vitest";

import { LABEL_FIELDS } from "../src/labels.js";
import {
  LABEL_FIELD_NAME_MAX,
  labelFieldList,
  labelFieldName,
} from "../src/tui/overlays/labels/fields.js";

describe("label field names", () => {
  it("names every field in sentence case, within the dialog's cell", () => {
    for (const { key } of LABEL_FIELDS) {
      const name = labelFieldName(key);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(LABEL_FIELD_NAME_MAX);
      expect(name.charAt(0)).toBe(name.charAt(0).toUpperCase());
    }
  });

  it("uses the names people read on both screens", () => {
    expect(labelFieldName("qr")).toBe("QR code");
    expect(labelFieldName("color")).toBe("Color name");
    expect(labelFieldName("hex")).toBe("Color code");
    expect(labelFieldName("temps")).toBe("Temperatures");
    expect(labelFieldName("id")).toBe("Spool ID");
  });

  it("joins fields in print order as one sentence, keeping QR and ID capitals", () => {
    expect(labelFieldList(["id", "qr", "brand"])).toBe("QR code, brand, spool ID");
    expect(labelFieldList(["color", "temps"])).toBe("Color name, temperatures");
    expect(labelFieldList([])).toBe("");
  });
});
