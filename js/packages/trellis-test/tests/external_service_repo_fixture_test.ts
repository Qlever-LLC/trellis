import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  runTrellisIntegrationTests,
  type TrellisIntegrationRunnerOptions,
} from "@qlever-llc/trellis-test/integration/runner";
import config, {
  externalServiceRepoJsRoot,
  externalServiceRepoRoot,
  externalServiceRepoRuntime,
} from "./fixtures/external-service-repo/trellis.integration.ts";

type RunnerCommand = Parameters<
  NonNullable<TrellisIntegrationRunnerOptions["commandRunner"]>
>[0];

const fixtureConfigPath = join(
  externalServiceRepoRoot,
  "trellis.integration.ts",
);
const fixtureDenoConfigPath = join(externalServiceRepoRoot, "deno.json");
const fixtureTestPath = join(
  externalServiceRepoRoot,
  "integration",
  "rpc_smoke.integration_test.ts",
);
const fixtureTestName =
  "external.rpc-smoke calls service RPC through generic runner";
const sharedRuntimeEnv = "TRELLIS_TEST_SHARED_RUNTIME";

Deno.test("external service repo fixture config supplies the Trellis command", () => {
  assertEquals(externalServiceRepoRuntime.trellis.command, {
    cmd: Deno.execPath(),
    args: ["run", "-A", "services/trellis/main.ts"],
    cwd: externalServiceRepoJsRoot,
  });
  assertEquals(config.denoTestArgs, ["-A", "-c", fixtureDenoConfigPath]);
  assertEquals(config.cases, [
    {
      id: "external.rpc-smoke",
      fixture: "external-service-repo",
      file: "integration/rpc_smoke.integration_test.ts",
      testName: fixtureTestName,
      coverage: ["rpc", "smoke"],
    },
  ]);
});

Deno.test("external service repo fixture runs through generic runner serial mode", async () => {
  const commands: RunnerCommand[] = [];

  const code = await runTrellisIntegrationTests({
    args: ["--config", fixtureConfigPath, "--case", "external.rpc-smoke"],
    cwd: externalServiceRepoRoot,
    commandRunner(command) {
      commands.push(command);
      return Promise.resolve(0);
    },
  });

  assertEquals(code, 0);
  assertEquals(commands, [
    {
      executable: Deno.execPath(),
      cwd: externalServiceRepoRoot,
      args: [
        "test",
        "-A",
        "-c",
        fixtureDenoConfigPath,
        "--filter",
        "/^(?:external\\.rpc-smoke calls service RPC through generic runner)$/",
        fixtureTestPath,
      ],
    },
  ]);
});

Deno.test("external service repo fixture runs through generic runner parallel mode", async () => {
  const commands: RunnerCommand[] = [];
  let stopCalls = 0;

  const code = await runTrellisIntegrationTests({
    args: [
      "--config",
      fixtureConfigPath,
      "--parallel",
      "--jobs",
      "2",
      "--fixture",
      "external-service-repo",
    ],
    cwd: externalServiceRepoRoot,
    commandRunner(command) {
      commands.push(command);
      return Promise.resolve(0);
    },
    async sharedRuntimeHostStarter(args) {
      assertEquals(args.runtime, externalServiceRepoRuntime);
      return {
        manifestPath: "/tmp/external-service-repo-manifest.json",
        env: {
          [sharedRuntimeEnv]: "/tmp/external-service-repo-manifest.json",
        },
        async stop() {
          stopCalls += 1;
        },
      };
    },
  });

  assertEquals(code, 0);
  assertEquals(stopCalls, 1);
  assertEquals(commands, [
    {
      executable: Deno.execPath(),
      cwd: externalServiceRepoRoot,
      env: {
        [sharedRuntimeEnv]: "/tmp/external-service-repo-manifest.json",
        DENO_JOBS: "2",
      },
      args: [
        "test",
        "-A",
        "-c",
        fixtureDenoConfigPath,
        "--parallel",
        "--filter",
        "/^(?:external\\.rpc-smoke calls service RPC through generic runner)$/",
        fixtureTestPath,
      ],
    },
  ]);
});
