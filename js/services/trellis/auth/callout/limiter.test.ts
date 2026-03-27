import { assert, assertEquals } from "@std/assert";

import { CalloutLimiter } from "./limiter.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

Deno.test("CalloutLimiter enforces global concurrency", async () => {
  const limiter = new CalloutLimiter({
    maxConcurrent: 1,
    maxQueue: 10,
    maxConcurrentPerIp: 10,
    maxConcurrentPerServer: 10,
  });

  const aReleased = deferred<void>();
  const a = await limiter.acquire({ ip: "1.1.1.1", server: "s1" });
  assert(a);

  let bAcquired = false;
  const bPromise = (async () => {
    const b = await limiter.acquire({ ip: "2.2.2.2", server: "s1" });
    assert(b);
    bAcquired = true;
    aReleased.promise.finally(() => b());
  })();

  await Promise.resolve();
  assertEquals(bAcquired, false);

  a();
  aReleased.resolve();
  await bPromise;
  assertEquals(bAcquired, true);
});

Deno.test("CalloutLimiter enforces per-ip concurrency", async () => {
  const limiter = new CalloutLimiter({
    maxConcurrent: 10,
    maxQueue: 10,
    maxConcurrentPerIp: 1,
    maxConcurrentPerServer: 10,
  });

  const releaseA1 = await limiter.acquire({ ip: "1.1.1.1", server: "s1" });
  assert(releaseA1);

  let acquiredA2 = false;
  const acquireA2 = limiter.acquire({ ip: "1.1.1.1", server: "s1" }).then(
    (r) => {
      assert(r);
      acquiredA2 = true;
      return r;
    },
  );

  // A different IP should still acquire immediately.
  const releaseB = await limiter.acquire({ ip: "2.2.2.2", server: "s1" });
  assert(releaseB);
  releaseB();

  await Promise.resolve();
  assertEquals(acquiredA2, false);

  releaseA1();
  const releaseA2 = await acquireA2;
  releaseA2();
});

Deno.test("CalloutLimiter fast-fails when the wait queue is full", async () => {
  const limiter = new CalloutLimiter({
    maxConcurrent: 1,
    maxQueue: 0,
    maxConcurrentPerIp: 1,
    maxConcurrentPerServer: 1,
  });

  const release = await limiter.acquire({ ip: "1.1.1.1", server: "s1" });
  assert(release);

  assertEquals(
    await limiter.acquire({ ip: "2.2.2.2", server: "s1" }),
    null,
  );

  release();
});
