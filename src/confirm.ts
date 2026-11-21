// ABOUTME: Asks a yes/no question on the terminal; only an explicit "y" or "yes" counts as yes.
// ABOUTME: Answers null when stdin isn't a terminal, so scripted runs never wait on a question nobody sees.

import { createInterface } from "node:readline";

export interface ConfirmInput extends NodeJS.ReadableStream {
  isTTY?: boolean;
}

export function askYesNo(
  question: string,
  input: ConfirmInput = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<boolean | null> {
  if (!input.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    let answered = false;
    const finish = (yes: boolean) => {
      if (answered) return;
      answered = true;
      rl.close();
      resolve(yes);
    };
    // ctrl+c and ctrl+d are a no, not a hang.
    rl.on("SIGINT", () => {
      output.write("\n");
      finish(false);
    });
    rl.on("close", () => finish(false));
    rl.question(question, (answer) => finish(/^y(es)?$/i.test(answer.trim())));
  });
}
