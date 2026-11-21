// ABOUTME: Unit tests for the shared choice list: one choice or a checklist, with type-ahead and cancel.
// ABOUTME: The list is pure state + keys, so it is tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import {
  type ChoiceAction,
  type ChoiceItem,
  type ChoiceState,
  choiceInput,
  initialChoiceState,
} from "../src/tui/ChoiceList.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

const ITEMS: ChoiceItem[] = [
  { value: "Bambu Lab A1 0.4 nozzle", label: "A1 0.4 nozzle" },
  { value: "Bambu Lab X1 Carbon 0.4 nozzle", label: "X1 Carbon 0.4 nozzle" },
  { value: "Bambu Lab X1 Carbon 0.6 nozzle", label: "X1 Carbon 0.6 nozzle" },
];

function update(action: ChoiceAction): ChoiceState {
  if (action.type !== "update") throw new Error(`expected an update, got ${action.type}`);
  return action.state;
}

describe("initialChoiceState", () => {
  it("ticks the current values and starts on the first of them", () => {
    expect(initialChoiceState(ITEMS, ["Bambu Lab X1 Carbon 0.6 nozzle"])).toEqual({
      cursor: 2,
      ticked: new Set(["Bambu Lab X1 Carbon 0.6 nozzle"]),
      error: "",
    });
    expect(initialChoiceState(ITEMS, []).cursor).toBe(0);
  });
});

describe("choiceInput", () => {
  const start = initialChoiceState(ITEMS, ["Bambu Lab X1 Carbon 0.4 nozzle"]);

  it("picks the highlighted item with enter when only one can be chosen", () => {
    expect(choiceInput({ ...start, cursor: 2 }, "", key({ return: true }), ITEMS, false)).toEqual({
      type: "done",
      values: ["Bambu Lab X1 Carbon 0.6 nozzle"],
    });
  });

  it("ticks with space and confirms the ticked items in list order with enter", () => {
    const ticked = update(choiceInput({ ...start, cursor: 2 }, " ", key(), ITEMS, true));
    expect(ticked.ticked).toEqual(
      new Set(["Bambu Lab X1 Carbon 0.4 nozzle", "Bambu Lab X1 Carbon 0.6 nozzle"]),
    );
    expect(choiceInput(ticked, "", key({ return: true }), ITEMS, true)).toEqual({
      type: "done",
      values: ["Bambu Lab X1 Carbon 0.4 nozzle", "Bambu Lab X1 Carbon 0.6 nozzle"],
    });
  });

  it("asks for at least one ticked item", () => {
    const none = update(choiceInput(start, " ", key(), ITEMS, true));
    expect(none.ticked.size).toBe(0);
    expect(update(choiceInput(none, "", key({ return: true }), ITEMS, true)).error).toBe(
      "Tick at least one with space",
    );
  });

  it("cancels with escape", () => {
    expect(choiceInput(start, "", key({ escape: true }), ITEMS, true)).toEqual({ type: "cancel" });
  });

  it("moves with the arrows and jumps by the letters typed", () => {
    expect(update(choiceInput(start, "", key({ upArrow: true }), ITEMS, true)).cursor).toBe(0);
    const x = update(choiceInput({ ...start, cursor: 0 }, "x", key(), ITEMS, true, 0));
    expect(x.cursor).toBe(1);
    expect(update(choiceInput(x, "1", key(), ITEMS, true, 10)).cursor).toBe(1);
  });

  it("clears the error on the next key", () => {
    expect(
      update(
        choiceInput(
          { ...start, error: "Tick at least one with space" },
          "",
          key({ downArrow: true }),
          ITEMS,
          true,
        ),
      ).error,
    ).toBe("");
  });
});
