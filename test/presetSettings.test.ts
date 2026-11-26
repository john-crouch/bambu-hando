// ABOUTME: Tests for the print settings a source gives a preset: bounds, midpoints, layering sources by precedence,
// ABOUTME: and writing them over the Generic template's values (bed plates, flow, max volumetric speed, pressure advance).

import { describe, expect, it } from "vitest";

import {
  applySettings,
  checkedSettings,
  layered,
  midpoint,
  settingsFromRecord,
  settingsFromSpoolProfile,
} from "../src/presetSettings.js";

describe("midpoint", () => {
  it("is the rounded middle of a range, or the one end given", () => {
    expect(midpoint(230, 260)).toBe(245);
    expect(midpoint(60, 71)).toBe(66);
    expect(midpoint(70, null)).toBe(70);
    expect(midpoint(null, 80)).toBe(80);
    expect(midpoint(null, null)).toBeUndefined();
  });
});

describe("checkedSettings", () => {
  it("keeps values BambuStudio takes and drops the rest, so the template's stay", () => {
    expect(
      checkedSettings({
        printTemp: 245,
        bedTemp: 65,
        flowRatio: 0.95,
        maxVolumetricSpeed: 11.5,
        pressureAdvance: { k: 0.02, enabled: false },
      }),
    ).toEqual({
      printTemp: 245,
      bedTemp: 65,
      flowRatio: 0.95,
      maxVolumetricSpeed: 11.5,
      pressureAdvance: { k: 0.02, enabled: false },
    });
    expect(
      checkedSettings({
        printTemp: 400,
        bedTemp: 0,
        flowRatio: 0,
        maxVolumetricSpeed: 0.2,
        pressureAdvance: { k: 3, enabled: true },
      }),
    ).toEqual({});
    expect(checkedSettings({ bedTemp: 121, flowRatio: 2.5, maxVolumetricSpeed: 201 })).toEqual({});
  });
});

describe("layered", () => {
  it("takes each value from the first source that has it", () => {
    expect(
      layered(
        { flowRatio: 0.97, pressureAdvance: { k: 0.03, enabled: true } },
        {
          printTemp: 245,
          bedTemp: 65,
          flowRatio: 0.95,
          pressureAdvance: { k: 0.02, enabled: false },
        },
        { bedTemp: 70, maxVolumetricSpeed: 12 },
      ),
    ).toEqual({
      printTemp: 245,
      bedTemp: 65,
      flowRatio: 0.97,
      maxVolumetricSpeed: 12,
      pressureAdvance: { k: 0.03, enabled: true },
    });
    expect(layered()).toEqual({});
  });
});

describe("settingsFromRecord", () => {
  it("takes 3DFP's community values, with its K stored but left off", () => {
    expect(
      settingsFromRecord({
        tempMin: 230,
        tempMax: 260,
        bedTempMin: 60,
        bedTempMax: 70,
        flowRatio: 0.95,
        maxVolumetricSpeed: 11.5,
        kValue: 0.02,
      }),
    ).toEqual({
      printTemp: 245,
      bedTemp: 65,
      flowRatio: 0.95,
      maxVolumetricSpeed: 11.5,
      pressureAdvance: { k: 0.02, enabled: false },
    });
    expect(
      settingsFromRecord({
        tempMin: null,
        tempMax: null,
        bedTempMin: null,
        bedTempMax: null,
        flowRatio: null,
        maxVolumetricSpeed: null,
        kValue: null,
      }),
    ).toEqual({});
  });
});

describe("settingsFromSpoolProfile", () => {
  it("takes only what 3DFP marks as the spool's own calibration, with its K turned on", () => {
    expect(
      settingsFromSpoolProfile([
        { key: "nozzle_temperature", value: "250", source: "spool" },
        { key: "hot_plate_temp", value: "75", source: "spool" },
        { key: "textured_plate_temp", value: "75", source: "spool" },
        { key: "filament_flow_ratio", value: "0.97", source: "spool" },
        { key: "pressure_advance", value: "0.031", source: "spool" },
        { key: "filament_max_volumetric_speed", value: "11.5", source: "max_volumetric_speed" },
        { key: "nozzle_temperature_range_low", value: "230", source: "temp_min" },
      ]),
    ).toEqual({
      printTemp: 250,
      bedTemp: 75,
      flowRatio: 0.97,
      pressureAdvance: { k: 0.031, enabled: true },
    });
    expect(
      settingsFromSpoolProfile([{ key: "nozzle_temperature", value: "x", source: "spool" }]),
    ).toEqual({});
  });
});

describe("applySettings", () => {
  const template = {
    nozzle_temperature: ["255", "nil"],
    nozzle_temperature_initial_layer: ["255", "nil"],
    hot_plate_temp: ["70"],
    hot_plate_temp_initial_layer: ["70"],
    textured_plate_temp: ["70"],
    textured_plate_temp_initial_layer: ["70"],
    eng_plate_temp: ["70"],
    eng_plate_temp_initial_layer: ["70"],
    cool_plate_temp: ["0"],
    cool_plate_temp_initial_layer: ["0"],
    supertack_plate_temp: ["70"],
    filament_flow_ratio: ["0.95", "0.95"],
    filament_max_volumetric_speed: ["12"],
  };

  it("writes the bed temperature to the PEI and engineering plates only, keeping the rest", () => {
    const preset = applySettings(template, {
      printTemp: 245,
      bedTemp: 65,
      flowRatio: 0.98,
      maxVolumetricSpeed: 11.5,
    });
    expect(preset).toMatchObject({
      nozzle_temperature: ["245", "nil"],
      nozzle_temperature_initial_layer: ["245", "nil"],
      hot_plate_temp: ["65"],
      hot_plate_temp_initial_layer: ["65"],
      textured_plate_temp: ["65"],
      textured_plate_temp_initial_layer: ["65"],
      eng_plate_temp: ["65"],
      eng_plate_temp_initial_layer: ["65"],
      // 0 is "this plate can't take the filament": a source's bed temperature mustn't undo it.
      cool_plate_temp: ["0"],
      supertack_plate_temp: ["70"],
      filament_flow_ratio: ["0.98", "0.98"],
      filament_max_volumetric_speed: ["11.5"],
    });
    expect(preset).not.toHaveProperty("enable_pressure_advance");
  });

  it("never turns on a plate the template marks as unsupported (0)", () => {
    const preset = applySettings(
      { ...template, eng_plate_temp: ["0"], eng_plate_temp_initial_layer: ["0"] },
      { bedTemp: 65 },
    );
    expect(preset).toMatchObject({
      hot_plate_temp: ["65"],
      eng_plate_temp: ["0"],
      eng_plate_temp_initial_layer: ["0"],
    });
  });

  it("writes pressure advance with its switch", () => {
    expect(applySettings(template, { pressureAdvance: { k: 0.031, enabled: true } })).toMatchObject(
      { enable_pressure_advance: ["1"], pressure_advance: ["0.031"] },
    );
    expect(applySettings(template, { pressureAdvance: { k: 0.02, enabled: false } })).toMatchObject(
      { enable_pressure_advance: ["0"], pressure_advance: ["0.02"] },
    );
  });

  it("changes nothing without settings", () => {
    expect(applySettings(template, {})).toEqual(template);
  });
});
