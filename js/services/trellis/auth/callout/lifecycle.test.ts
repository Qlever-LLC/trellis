import { assertEquals } from "@std/assert";

import { __testing__ } from "./callout.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

Deno.test("auth callout drain waits for in-flight handlers", async () => {
  const done = deferred<void>();
  const inFlight = new Set<Promise<void>>([done.promise]);

  let drained = false;
  const drain = __testing__.waitForInFlightHandlers(inFlight, 500).then(
    (result) => {
      drained = true;
      return result;
    },
  );

  await Promise.resolve();
  assertEquals(drained, false);

  done.resolve();
  assertEquals(await drain, "drained");
  assertEquals(drained, true);
});

Deno.test("auth callout drain is bounded", async () => {
  const never = new Promise<void>(() => {});
  const inFlight = new Set<Promise<void>>([never]);

  assertEquals(
    await __testing__.waitForInFlightHandlers(inFlight, 1),
    "timed_out",
  );
});
