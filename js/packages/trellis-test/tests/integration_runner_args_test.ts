import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  runTrellisIntegrationTests,
  type TrellisIntegrationRunnerConfig,
  type TrellisIntegrationRunnerOptions,
} from "../src/integration/runner.ts";
import { TRELLIS_TEST_SHARED_RUNTIME_ENV } from "../src/integration/shared_runtime_protocol.ts";

type RunnerCommand = Parameters<
  NonNullable<TrellisIntegrationRunnerOptions["commandRunner"]>
>[0];

const runtime = {
  trellis: {
    command: { cmd: "deno", args: ["run", "./trellis.ts"] },
  },
} satisfies TrellisIntegrationRunnerConfig["runtime"];

const config = {
  runtime,
  cases: [
    {
      id: "billing.invoice-created",
      fixture: "billing",
      file: "integration/billing/invoice_created.integration_test.ts",
      testName: "billing.invoice-created publishes an invoice event",
      coverage: ["rpc", "events"],
    },
    {
      id: "billing.invoice-refunded",
      fixture: "billing",
      file: "integration/billing/invoice_refunded.integration_test.ts",
      testName: "billing.invoice-refunded publishes refund (v2)",
      coverage: ["events"],
    },
    {
      id: "orders.created",
      fixture: "orders",
      file: "integration/orders/orders.integration_test.ts",
      testName: "orders.created creates state [smoke]",
      coverage: ["state"],
    },
  ],
} satisfies TrellisIntegrationRunnerConfig;

Deno.test("runner prints help without requiring config", async () => {
  const output: string[] = [];
  const code = await runTrellisIntegrationTests({
    args: ["--help"],
    output: {
      log(message) {
        output.push(message);
      },
    },
  });

  assertEquals(code, 0);
  assertEquals(output.length, 1);
  assertStringIncludes(output[0], "--config <path>");
});

Deno.test("runner validates required and malformed arguments", async () => {
  await assertRejects(
    () => runTrellisIntegrationTests({ args: [] }),
    Error,
    "--config is required",
  );
  await assertRejects(
    () => runTrellisIntegrationTests({ args: ["--config"] }),
    Error,
    "--config requires a value",
  );
  await assertRejects(
    () =>
      runTrellisIntegrationTests({
        args: ["--jobs", "0"],
        config,
        commandRunner: async () => 0,
      }),
    Error,
    "--jobs requires a positive integer",
  );
  await assertRejects(
    () =>
      runTrellisIntegrationTests({
        args: ["--jobs=1.5"],
        config,
        commandRunner: async () => 0,
      }),
    Error,
    "--jobs requires a positive integer",
  );
});

Deno.test("runner validates unknown case filters clearly", async () => {
  await assertRejects(
    () =>
      runTrellisIntegrationTests({
        args: ["--fixture", "missing"],
        config,
        commandRunner: async () => 0,
      }),
    Error,
    "unknown Trellis integration fixture filter(s): missing",
  );
  await assertRejects(
    () =>
      runTrellisIntegrationTests({
        args: ["--case=missing.case"],
        config,
        commandRunner: async () => 0,
      }),
    Error,
    "unknown Trellis integration case filter(s): missing.case",
  );
  await assertRejects(
    () =>
      runTrellisIntegrationTests({
        args: ["--coverage", "missing"],
        config,
        commandRunner: async () => 0,
      }),
    Error,
    "unknown Trellis integration coverage filter(s): missing",
  );
});

Deno.test("runner loads config modules and resolves case files relative to config", async () => {
  const tempDir = await Deno.makeTempDir();
  const configDir = join(tempDir, "service-repo", "test-config");
  await Deno.mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "trellis.integration.ts");
  await Deno.writeTextFile(
    configPath,
    `export default {
      runtime: {
        trellis: { command: { cmd: "deno", args: ["run", "./trellis.ts"] } },
      },
      cases: [{
        id: "billing.invoice-created",
        fixture: "billing",
        file: "../integration/billing_test.ts",
        testName: "billing.invoice-created publishes (v1)",
        coverage: ["events"],
      }],
    };`,
  );
  const commands: RunnerCommand[] = [];

  const code = await runTrellisIntegrationTests({
    args: ["--config", configPath, "--fixture", "billing"],
    cwd: tempDir,
    commandRunner(command) {
      commands.push(command);
      return Promise.resolve(0);
    },
  });

  assertEquals(code, 0);
  assertEquals(commands.length, 1);
  assertEquals(commands[0].cwd, tempDir);
  assertEquals(commands[0].args, [
    "test",
    "--filter",
    "/^(?:billing\\.invoice-created publishes \\(v1\\))$/",
    join(configDir, "..", "integration", "billing_test.ts"),
  ]);
});

Deno.test("runner selects cases by filters and deduplicates files in case order", async () => {
  const cwd = Deno.cwd();
  const commands: RunnerCommand[] = [];

  const code = await runTrellisIntegrationTests({
    args: ["--coverage", "events"],
    config: {
      runtime,
      cases: [
        {
          id: "first",
          fixture: "shared",
          file: "integration/shared.integration_test.ts",
          testName: "shared first [case]",
          coverage: ["events"],
        },
        {
          id: "second",
          fixture: "shared",
          file: "integration/shared.integration_test.ts",
          testName: "shared second +case",
          coverage: ["events"],
        },
        {
          id: "third",
          fixture: "other",
          file: "integration/other.integration_test.ts",
          testName: "other third",
          coverage: ["state"],
        },
      ],
    },
    commandRunner(command) {
      commands.push(command);
      return Promise.resolve(0);
    },
  });

  assertEquals(code, 0);
  assertEquals(commands[0].args, [
    "test",
    "--filter",
    "/^(?:shared first \\[case\\]|shared second \\+case)$/",
    join(cwd, "integration", "shared.integration_test.ts"),
  ]);
});

Deno.test("runner filters serial runs and passes child deno test arguments", async () => {
  const cwd = Deno.cwd();
  const commands: RunnerCommand[] = [];

  const code = await runTrellisIntegrationTests({
    args: ["--deno-test-arg", "-A", "--", "-c", "deno.json"],
    denoTestArgs: ["--allow-read"],
    config: {
      runtime,
      denoTestArgs: ["--quiet"],
      cases: [
        {
          id: "billing.invoice-created",
          fixture: "billing",
          file: "integration/billing/invoice_created.integration_test.ts",
          testName: "billing.invoice-created publishes an invoice event",
        },
      ],
    },
    commandRunner(command) {
      commands.push(command);
      return Promise.resolve(0);
    },
  });

  assertEquals(code, 0);
  assertEquals(commands[0].args, [
    "test",
    "--quiet",
    "--allow-read",
    "-A",
    "-c",
    "deno.json",
    "--filter",
    "/^(?:billing\\.invoice-created publishes an invoice event)$/",
    join(cwd, "integration", "billing", "invoice_created.integration_test.ts"),
  ]);
});

Deno.test("runner constructs parallel commands with shared host env and DENO_JOBS", async () => {
  const commands: RunnerCommand[] = [];
  const startedRuntime: TrellisIntegrationRunnerConfig["runtime"][] = [];
  let stopCalls = 0;

  const code = await runTrellisIntegrationTests({
    args: ["--parallel", "--jobs", "4", "--case", "orders.created"],
    config,
    commandRunner(command) {
      commands.push(command);
      return Promise.resolve(7);
    },
    async sharedRuntimeHostStarter(args) {
      startedRuntime.push(args.runtime);
      return {
        manifestPath: "/tmp/manifest.json",
        env: { [TRELLIS_TEST_SHARED_RUNTIME_ENV]: "/tmp/manifest.json" },
        async stop() {
          stopCalls += 1;
        },
      };
    },
  });

  assertEquals(code, 7);
  assertEquals(startedRuntime, [runtime]);
  assertEquals(stopCalls, 1);
  assertEquals(commands.length, 1);
  assertEquals(commands[0].args, [
    "test",
    "--parallel",
    "--filter",
    "/^(?:orders\\.created creates state \\[smoke\\])$/",
    join(Deno.cwd(), "integration", "orders", "orders.integration_test.ts"),
  ]);
  assertEquals(commands[0].env, {
    [TRELLIS_TEST_SHARED_RUNTIME_ENV]: "/tmp/manifest.json",
    DENO_JOBS: "4",
  });
});

Deno.test("runner skips optional conformance hook when requested", async () => {
  let conformanceCalls = 0;

  await runTrellisIntegrationTests({
    args: ["--skip-conformance"],
    config: {
      ...config,
      conformance() {
        conformanceCalls += 1;
      },
    },
    commandRunner: async () => 0,
  });

  assertEquals(conformanceCalls, 0);
});
