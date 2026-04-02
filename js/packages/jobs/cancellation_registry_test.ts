import { assert, assertEquals } from "@std/assert";

import { JobCancellationToken } from "./active-job.ts";
import { ActiveJobCancellationRegistry } from "./cancellation-registry.ts";

Deno.test("ActiveJobCancellationRegistry cancels registered tokens and supports pending cancellation", () => {
  const registry = new ActiveJobCancellationRegistry();
  const token = new JobCancellationToken();
  const guard = registry.register("documents.document-process.job-1", token);

  assert(registry.cancel("documents.document-process.job-1"));
  assert(token.isCancelled());
  guard.dispose();

  const lateToken = new JobCancellationToken();
  assertEquals(registry.cancel("documents.document-process.job-2"), false);
  const lateGuard = registry.register("documents.document-process.job-2", lateToken);
  assert(lateToken.isCancelled());
  lateGuard.dispose();
});

Deno.test("ActiveJobCancellationRegistry clears pending cancellation and unregisters on dispose", () => {
  const registry = new ActiveJobCancellationRegistry();
  assertEquals(registry.cancel("documents.document-process.job-1"), false);
  registry.clearPending("documents.document-process.job-1");

  const token = new JobCancellationToken();
  const guard = registry.register("documents.document-process.job-1", token);
  assertEquals(token.isCancelled(), false);
  guard.dispose();

  assertEquals(registry.cancel("documents.document-process.job-1"), false);
  assertEquals(token.isCancelled(), false);
});
