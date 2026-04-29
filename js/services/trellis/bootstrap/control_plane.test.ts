import { assert, assertEquals } from "@std/assert";

import { contract as consoleContract } from "../../../apps/console/contract.ts";
import { planUserContractApproval } from "../auth/approval/plan.ts";
import { ContractStore } from "../catalog/store.ts";
import { resolveBuiltinContracts } from "./control_plane.ts";

Deno.test("resolveBuiltinContracts includes Trellis Jobs as a standard API", () => {
  const builtins = resolveBuiltinContracts();
  const jobs = builtins.find((entry) =>
    entry.contract.id === "trellis.jobs@v1"
  );

  assert(jobs !== undefined);
  assertEquals(jobs.contract.kind, "service");
  assertEquals(jobs.contract.displayName, "Trellis Jobs");
  assertEquals(jobs.digest.length > 0, true);
});

Deno.test("console approval resolves Jobs access from built-in contracts", async () => {
  const store = new ContractStore(resolveBuiltinContracts());

  const plan = await planUserContractApproval(store, consoleContract.CONTRACT);

  assertEquals(plan.contract.id, "trellis.console@v1");
  assert(plan.approval.capabilities.includes("jobs.admin.read"));
  assert(plan.publishSubjects.includes("rpc.v1.Jobs.List"));
  assert(plan.publishSubjects.includes("rpc.v1.Jobs.ListServices"));
});
