// ABOUTME: A model/update/view runtime in Bubble Tea's style: update is pure and returns commands to run.
// ABOUTME: Commands are async functions that dispatch messages (one, several, or a stream), never touching the model.

import { useCallback, useRef, useState } from "react";

export type Dispatch<Msg> = (msg: Msg) => void;

/** Side work an update asks for: it may dispatch any number of messages, now or later. */
export type Cmd<Msg> = (dispatch: Dispatch<Msg>) => void | Promise<void>;

/** The next model and the commands to run, from the current model and a message. Pure. */
export type Update<Model, Msg> = (model: Model, msg: Msg) => [Model, Cmd<Msg>[]];

/** Marks send's commands: the program queues their messages at once instead of deferring them. */
const IMMEDIATE = Symbol("immediate");

/**
 * A command that sends messages on, for an update that wants another update to run. The program queues them
 * right after the update that returned it, ahead of anything dispatched later: two keys Ink parsed from one
 * read arrive back to back, and what the first one sends (the key after an esc) must not fall behind the second.
 */
export function send<Msg>(...msgs: Msg[]): Cmd<Msg> {
  const cmd: Cmd<Msg> = (dispatch) => {
    for (const msg of msgs) dispatch(msg);
  };
  return Object.assign(cmd, { [IMMEDIATE]: true });
}

function immediate<Msg>(cmd: Cmd<Msg>): boolean {
  return (cmd as { [IMMEDIATE]?: boolean })[IMMEDIATE] === true;
}

/** Runs update and its commands outside React: the store App's hook wraps, and what tests drive directly. */
export class Program<Model, Msg> {
  private current: Model;
  private readonly listeners = new Set<() => void>();
  private queue: Msg[] = [];
  private draining = false;

  constructor(
    init: [Model, Cmd<Msg>[]],
    private readonly update: Update<Model, Msg>,
    /** A command that throws: turned into a message so the app shows it instead of crashing. */
    private readonly onCmdError: (err: unknown) => Msg,
  ) {
    this.current = init[0];
    this.run(init[1]);
    if (this.queue.length > 0) this.drain();
  }

  get model(): Model {
    return this.current;
  }

  /** Messages dispatched while an update runs are queued, so updates never nest. */
  dispatch = (msg: Msg): void => {
    this.queue.push(msg);
    if (!this.draining) this.drain();
  };

  private drain(): void {
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift() as Msg;
        const [model, cmds] = this.update(this.current, next);
        this.current = model;
        this.run(cmds);
      }
    } finally {
      this.draining = false;
    }
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private run(cmds: Cmd<Msg>[]): void {
    for (const cmd of cmds) {
      // send's messages join the queue now, in order, so they run before anything dispatched later.
      if (immediate(cmd)) {
        cmd((msg) => this.queue.push(msg));
        continue;
      }
      // Deferred, so a command never dispatches into the update that returned it.
      queueMicrotask(() => {
        try {
          const done = cmd(this.dispatch);
          if (done instanceof Promise) done.catch((err) => this.dispatch(this.onCmdError(err)));
        } catch (err) {
          this.dispatch(this.onCmdError(err));
        }
      });
    }
  }
}

/** The program as React state: re-renders on every dispatch. */
export function useProgram<Model, Msg>(create: () => Program<Model, Msg>): [Model, Dispatch<Msg>] {
  const ref = useRef<Program<Model, Msg> | null>(null);
  if (!ref.current) ref.current = create();
  const program = ref.current;
  const [, setVersion] = useState(0);
  const subscribed = useRef(false);
  if (!subscribed.current) {
    subscribed.current = true;
    program.subscribe(() => setVersion((v) => v + 1));
  }
  const dispatch = useCallback((msg: Msg) => program.dispatch(msg), [program]);
  return [program.model, dispatch];
}
