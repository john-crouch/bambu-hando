// ABOUTME: Tests for the TUI runtime (Program: pure update, deferred commands, queued messages) and the key model.
// ABOUTME: Every tab builds on these, so their ordering and error handling are pinned here.

import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";

import { keyPress, keyPresses, letter, press, typed } from "../src/tui/core/keys.js";
import { type Cmd, Program, send } from "../src/tui/core/program.js";

type Msg = { type: "add"; n: number } | { type: "later" } | { type: "boom" } | { type: "error" };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function counter() {
  const seen: string[] = [];
  const program = new Program<number, Msg>(
    [0, []],
    (model, msg) => {
      seen.push(msg.type);
      if (msg.type === "add") return [model + msg.n, []];
      if (msg.type === "later") return [model, [send<Msg>({ type: "add", n: 10 })]];
      if (msg.type === "boom")
        return [
          model,
          [
            (() => {
              throw new Error("nope");
            }) as Cmd<Msg>,
          ],
        ];
      return [-1, []];
    },
    () => ({ type: "error" }),
  );
  return { program, seen };
}

describe("Program", () => {
  it("applies messages in order and notifies once per dispatch", () => {
    const { program } = counter();
    const listener = vi.fn();
    program.subscribe(listener);
    program.dispatch({ type: "add", n: 2 });
    program.dispatch({ type: "add", n: 3 });
    expect(program.model).toBe(5);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("runs commands after the update that returned them", async () => {
    const { program, seen } = counter();
    program.dispatch({ type: "later" });
    expect(program.model).toBe(0);
    await flush();
    expect(program.model).toBe(10);
    expect(seen).toEqual(["later", "add"]);
  });

  it("turns a throwing command into a message", async () => {
    const { program } = counter();
    program.dispatch({ type: "boom" });
    await flush();
    expect(program.model).toBe(-1);
  });

  it("runs the initial commands", async () => {
    const program = new Program<number, Msg>(
      [1, [send<Msg>({ type: "add", n: 1 })]],
      (model, msg) => [msg.type === "add" ? model + msg.n : model, []],
      () => ({ type: "error" }),
    );
    await flush();
    expect(program.model).toBe(2);
  });
});

const KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};

describe("keyPress", () => {
  it("names arrows, enter, esc, tab and space", () => {
    expect(keyPress("", { ...KEY, upArrow: true }).name).toBe("up");
    expect(keyPress("\r", { ...KEY, return: true }).name).toBe("enter");
    expect(keyPress("", { ...KEY, escape: true }).name).toBe("esc");
    expect(keyPress("", { ...KEY, tab: true, shift: true })).toMatchObject({
      name: "tab",
      shift: true,
    });
    expect(keyPress(" ", KEY)).toMatchObject({ name: "space", input: " " });
  });

  it("keeps a burst ending in enter as text, so a scan arrives whole", () => {
    expect(keyPress("00150603Z\r", { ...KEY, return: true })).toEqual({
      input: "00150603Z\r",
      ctrl: false,
      shift: false,
      meta: false,
    });
  });

  it("keeps ctrl+letter as the letter with ctrl", () => {
    expect(keyPress("k", { ...KEY, ctrl: true })).toMatchObject({ input: "k", ctrl: true });
  });
});

describe("key helpers", () => {
  it("typed and letter take printable text only", () => {
    expect(typed(press("a"))).toBe("a");
    expect(typed(press("space"))).toBe(" ");
    expect(typed(press("k", { ctrl: true }))).toBe("");
    expect(typed(press("down"))).toBe("");
    expect(letter(press("P"))).toBe("p");
    expect(letter(press("space"))).toBe("");
    expect(letter(press("ab"))).toBe("");
  });
});

describe("keyPresses", () => {
  const plain = (input: string) => ({ input, ctrl: false, shift: false, meta: false });

  it("passes a single key through as one", () => {
    expect(keyPresses("\t", { ...KEY, tab: true })).toEqual([
      keyPress("\t", { ...KEY, tab: true }),
    ]);
    expect(keyPresses("q", KEY)).toEqual([plain("q")]);
  });

  it("splits keys a busy machine delivered in one read: tab then ?, ? then tab", () => {
    expect(keyPresses("\t?", KEY)).toEqual([press("tab"), plain("?")]);
    expect(keyPresses("?\t", KEY)).toEqual([plain("?"), press("tab")]);
  });

  it("splits ctrl+letter from the text after it", () => {
    expect(keyPresses("\u000Bcatalog", KEY)).toEqual([
      press("k", { ctrl: true }),
      plain("catalog"),
    ]);
  });

  it("keeps a scanner's burst ending in enter whole, and splits what follows it", () => {
    expect(keyPresses("00150603Z\r", { ...KEY, return: true })).toEqual([plain("00150603Z\r")]);
    expect(keyPresses("ab\rcd\t", KEY)).toEqual([plain("ab\r"), plain("cd"), press("tab")]);
  });

  it("keeps typed words as text, even ones that spell a key's name, and a lone space as space", () => {
    expect(keyPresses("end\t", KEY)).toEqual([plain("end"), press("tab")]);
    expect(keyPresses("\t \t", KEY)).toEqual([press("tab"), press("space"), press("tab")]);
  });

  it("reads a lone enter and backspace inside a burst as those keys", () => {
    expect(keyPresses("\t\r", KEY)).toEqual([press("tab"), press("enter")]);
    expect(keyPresses("\tx\u007F", KEY)).toEqual([press("tab"), plain("x"), press("backspace")]);
  });
});
