import { assert, assertStringIncludes } from "@std/assert";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";

type RefreshHookFailure = {
  isErr(): boolean;
  error: { getContext(): Record<string, unknown> };
};

export function assertRefreshHookFailure(
  result: RefreshHookFailure,
  hook: string,
): void {
  assert(result.isErr());
  const causeMessage = result.error.getContext().causeMessage;
  assert(typeof causeMessage === "string");
  assertStringIncludes(causeMessage, hook);
}

export async function restartWithFailOnceHook(
  runtime: LiveTrellisRuntime,
  hook: string,
): Promise<void> {
  if (runtime.restartControlPlane === undefined) {
    throw new Error("fail-once hook restart requires isolated Trellis runtime");
  }
  const configPath = `${runtime.workdir}/trellis/config.jsonc`;
  const config: { trellisTest?: { failOnce?: string[] } } = JSON.parse(
    await Deno.readTextFile(configPath),
  );
  config.trellisTest = { ...config.trellisTest, failOnce: [hook] };
  await Deno.writeTextFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runtime.restartControlPlane();
}
