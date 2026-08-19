#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2))
  .then((code) => {
    // Realtime sockets keep the loop alive; exit deliberately once output is flushed.
    process.exitCode = code;
    process.stdout.write("", () => process.exit(code));
  })
  .catch((error) => {
    const payload = { ok: false, error: error?.message || String(error), code: error?.code || "fatal" };
    if (process.stdout.isTTY) process.stderr.write(`error ${payload.error}\n`);
    else process.stdout.write(JSON.stringify(payload) + "\n");
    process.exit(1);
  });
