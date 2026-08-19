// Minimal TTY prompt. Only used interactively; non-TTY callers never reach it.
import readline from "node:readline";

export function readHidden(prompt, hide = true) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (hide) {
      // Suppress echo so the password never appears on screen or in a scrollback.
      const output = rl.output;
      rl._writeToOutput = (chunk) => {
        if (chunk.includes(prompt)) output.write(prompt);
      };
    }
    rl.question(prompt, (answer) => {
      if (hide) process.stderr.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}
