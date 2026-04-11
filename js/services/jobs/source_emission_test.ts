import {
  canonicalizeJson,
  type JsonValue,
} from "@qlever-llc/trellis/contracts";
import { assertEquals, assertFalse } from "@std/assert";

Deno.test("trellis.jobs Rust-authored contract source matches emitted contract", async () => {
  const emitted = await Deno.readTextFile(
    new URL(
      "../../../generated/contracts/manifests/trellis.jobs@v1.json",
      import.meta.url,
    ),
  );
  const contractSourceUrl = new URL(
    "../../../rust/crates/service-jobs/contracts/trellis_jobs.rs",
    import.meta.url,
  );
  const contractSource = await Deno.readTextFile(contractSourceUrl);
  const includeMatch = contractSource.match(/include_str!\("([^"]+)"\)/);
  if (!includeMatch) {
    throw new Error("contract source does not expose include_str! contract payload");
  }

  const rustAuthored = await Deno.readTextFile(new URL(includeMatch[1], contractSourceUrl));
  assertEquals(
    emitted.trim(),
    canonicalizeJson(JSON.parse(rustAuthored) as JsonValue),
  );

  const manifest = JSON.parse(emitted) as {
    resources?: { kv?: Record<string, unknown> };
    schemas?: Record<string, unknown>;
  };
  assertFalse("serviceInstances" in (manifest.resources?.kv ?? {}));

  const workerHeartbeat = manifest.schemas?.WorkerHeartbeat as {
    properties?: Record<string, unknown>;
  } | undefined;
  const listServices = manifest.schemas?.JobsListServicesResponse as {
    properties?: { services?: { items?: { properties?: Record<string, unknown> } } };
  } | undefined;

  assertEquals(workerHeartbeat?.properties?.jobType !== undefined, true);
  assertEquals(workerHeartbeat?.properties?.instanceId !== undefined, true);
  assertEquals(
    listServices?.properties?.services?.items?.properties?.workers !== undefined,
    true,
  );
  assertFalse(
    "instances" in (listServices?.properties?.services?.items?.properties ?? {}),
  );
});
