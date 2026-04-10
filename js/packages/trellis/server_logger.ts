import { pino } from "pino";
import { getEnv } from "./env.ts";
import type { LoggerLike } from "./globals.ts";

const level = getEnv("PINO_LEVEL") || "info";

export const serverLogger: LoggerLike = pino({
  level,
  base: { library: "@qlever-llc/trellis" },
});
