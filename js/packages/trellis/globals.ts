import { pino } from "pino";
import { getEnv } from "./env.ts";

// Support Deno and browser (+ Svelte's strict TS rules)
const level = getEnv("PINO_LEVEL") || "info";

export const logger = pino({
  level,
  base: { library: "@qlever-llc/trellis" },
});
