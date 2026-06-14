import { jetstreamManager } from "@nats-io/jetstream";
import type { StreamConfig } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import { join } from "@std/path";
import {
  type ContainerRuntime,
  generateLocalNatsBootstrap,
  type LocalNatsBootstrapManifest,
  resolveContainerRuntime,
} from "./nats_bootstrap.ts";

const NATS_IMAGE = "docker.io/library/nats:2-alpine";

type StartedNatsContainer = {
  runtime: ContainerRuntime;
  containerName: string;
  natsUrl: string;
  websocketUrl: string;
  manifest: LocalNatsBootstrapManifest;
  nc: NatsConnection;
};

type StartNatsTestContainerOptions = {
  startupMs?: number;
};

function volumeMount(
  hostPath: string,
  containerPath: string,
  runtime: ContainerRuntime,
  mode: "ro" | "rw",
): string {
  const relabel = runtime === "podman" ? ",Z" : "";
  return `${hostPath}:${containerPath}:${mode}${relabel}`;
}

async function commandOutput(program: string, args: string[]): Promise<string> {
  const output = await new Deno.Command(program, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  if (output.success) return stdout;
  const stderr = new TextDecoder().decode(output.stderr).trim();
  throw new Error(
    `${program} ${args.join(" ")} failed with status ${output.code}: ${
      stderr || stdout
    }`,
  );
}

async function bestEffortRemoveContainer(
  runtime: ContainerRuntime,
  name: string,
): Promise<void> {
  await new Deno.Command(runtime, {
    args: ["rm", "--force", name],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).output().catch(() => undefined);
}

function parsePublishedPort(output: string): number {
  for (const line of output.split("\n")) {
    const port = line.trim().split(":").at(-1);
    if (!port) continue;
    const parsed = Number(port);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error(`failed to parse published container port from ${output}`);
}

async function waitForTcpPort(port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      conn.close();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`timed out waiting for NATS on 127.0.0.1:${port}`);
}

async function ensureStream(
  nc: NatsConnection,
  config: Pick<StreamConfig, "name"> & Partial<StreamConfig>,
): Promise<void> {
  const jsm = await jetstreamManager(nc);
  try {
    await jsm.streams.info(config.name);
    await jsm.streams.update(config.name, config);
  } catch (error) {
    if (error instanceof Error && error.message.includes("stream not found")) {
      await jsm.streams.add(config);
      return;
    }
    throw error;
  }
}

async function ensureSharedStreams(nc: NatsConnection): Promise<void> {
  await ensureStream(nc, { name: "trellis", subjects: ["events.>"] });
  await ensureStream(nc, {
    name: "JOBS",
    subjects: ["trellis.jobs.>"],
    retention: "limits",
    allow_direct: true,
  });
  await ensureStream(nc, {
    name: "JOBS_WORK",
    subjects: ["trellis.work.>"],
    retention: "workqueue",
    sources: [{
      name: "JOBS",
      subject_transforms: [
        {
          src: "trellis.jobs.*.*.*.created",
          dest: "trellis.work.$1.$2",
        },
        {
          src: "trellis.jobs.*.*.*.retried",
          dest: "trellis.work.$1.$2",
        },
      ],
    }],
  });
  await ensureStream(nc, {
    name: "JOBS_ADVISORIES",
    subjects: ["$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.JOBS_WORK.>"],
    retention: "limits",
  });
}

/** Manages an isolated NATS/JetStream container for Trellis tests. */
export class NatsTestContainer implements AsyncDisposable {
  readonly natsUrl: string;
  readonly websocketUrl: string;
  readonly manifest: LocalNatsBootstrapManifest;
  readonly nc: NatsConnection;
  readonly runtime: ContainerRuntime;
  readonly containerName: string;
  #stopped = false;

  private constructor(started: StartedNatsContainer) {
    this.runtime = started.runtime;
    this.containerName = started.containerName;
    this.natsUrl = started.natsUrl;
    this.websocketUrl = started.websocketUrl;
    this.manifest = started.manifest;
    this.nc = started.nc;
  }

  /** Starts a fresh NATS/JetStream container under `workdir`. */
  static async start(
    workdir: string,
    options: StartNatsTestContainerOptions = {},
  ): Promise<NatsTestContainer> {
    const runtime = await resolveContainerRuntime();
    const natsDir = join(workdir, "nats");
    const dataDir = join(natsDir, "data");
    await Deno.mkdir(dataDir, { recursive: true });
    const manifest = await generateLocalNatsBootstrap({
      outDir: natsDir,
      runtime,
    });
    const containerName = `trellis-test-nats-${Deno.pid}-${Date.now()}`;
    let nc: NatsConnection | undefined;

    try {
      await commandOutput(runtime, [
        "run",
        "--detach",
        "--name",
        containerName,
        "--publish",
        "127.0.0.1::4222",
        "--publish",
        "127.0.0.1::8080",
        "--volume",
        volumeMount(
          join(natsDir, manifest.paths.natsConfig),
          "/etc/nats/nats.conf",
          runtime,
          "ro",
        ),
        "--volume",
        volumeMount(
          join(natsDir, manifest.paths.jwtConfig),
          "/etc/nats/jwt.conf",
          runtime,
          "ro",
        ),
        "--volume",
        volumeMount(dataDir, "/data", runtime, "rw"),
        NATS_IMAGE,
        "-c",
        "/etc/nats/nats.conf",
      ]);

      const natsPort = parsePublishedPort(
        await commandOutput(runtime, ["port", containerName, "4222/tcp"]),
      );
      const websocketPort = parsePublishedPort(
        await commandOutput(runtime, ["port", containerName, "8080/tcp"]),
      );
      const startupMs = options.startupMs ?? 30_000;
      await waitForTcpPort(natsPort, startupMs);
      await waitForTcpPort(websocketPort, startupMs);
      const natsUrl = `nats://127.0.0.1:${natsPort}`;
      const websocketUrl = `ws://127.0.0.1:${websocketPort}`;
      nc = await connect({
        servers: natsUrl,
        authenticator: credsAuthenticator(
          await Deno.readFile(
            join(natsDir, manifest.paths.creds.trellisService),
          ),
        ),
      });
      await ensureSharedStreams(nc);
      return new NatsTestContainer({
        runtime,
        containerName,
        natsUrl,
        websocketUrl,
        manifest,
        nc,
      });
    } catch (error) {
      if (nc && !nc.isClosed()) await nc.close().catch(() => undefined);
      await bestEffortRemoveContainer(runtime, containerName);
      throw error;
    }
  }

  /** Stops the NATS connection and removes the container. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    let closeError: unknown;
    if (!this.nc.isClosed()) {
      try {
        await this.nc.close();
      } catch (error) {
        closeError = error;
      }
    }
    await bestEffortRemoveContainer(this.runtime, this.containerName);
    if (closeError) throw closeError;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.stop();
  }
}
