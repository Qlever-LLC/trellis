import { dirname } from "@std/path";

import { emitContractFromSource, parseSourceCliArgs } from "../source.ts";

const args = parseSourceCliArgs(Deno.args);

if (!args.source) {
  throw new Error("Missing required --source <contract-module>");
}

const emitted = await emitContractFromSource(args.source, args.export);
const text = `${emitted.canonical}\n`;

if (args.out) {
  await Deno.mkdir(dirname(args.out), { recursive: true });
  await Deno.writeTextFile(args.out, text);
} else {
  await Deno.stdout.write(new TextEncoder().encode(text));
}
