import { setInterval } from "node:timers/promises";
import { jetstreamManager } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core/internal";
import { connect } from "@nats-io/transport-deno";
import { exists } from "@std/fs";
import { join } from "@std/path";

export class NatsTest {
  public nc: NatsConnection;

  private running = false;
  private containerId: string;
  private workDir: string;

  private constructor(
    containerId: string,
    workDir: string,
    nc: NatsConnection,
  ) {
    this.running = true;
    this.containerId = containerId;
    this.workDir = workDir;
    this.nc = nc;
  }

  // Use a static "builder", because real constructors can't be async
  static async start(version = "latest"): Promise<NatsTest> {
    const workDir = await Deno.makeTempDir();

    // Create command and starts nats server
    const containerId = await runChecked([
      "podman",
      "run",
      "--rm",
      "--network",
      "host",
      "-v",
      `${workDir}:/work:Z`,
      "-v",
      `${join(import.meta.dirname || "", "nats.conf")}:/nats.conf:Z`,
      "-d",
      `nats:${version}`,
      "-c",
      "/nats.conf",
    ]);

    // Wait for, and parse ports file to find connection string
    const portsFile = join(workDir, "nats-server_1.ports");
    await waitFor(
      () => exists(portsFile),
      { description: "nats ports file", timeoutMs: 10_000 },
    );
    const ports = JSON.parse(await Deno.readTextFile(portsFile));

    const nc = await connect({ servers: ports.nats });

    const jsm = await jetstreamManager(nc);
    await jsm.streams.add({ name: "trellis", subjects: ["events.>"] });

    return new NatsTest(containerId, workDir, nc);
  }

  async [Symbol.asyncDispose]() {
    if (!this.running) {
      return;
    }

    await this.stop();
  }

  async stop() {
    if (!this.running) {
      return;
    }

    // Stop the client connection
    await this.nc.close();

    const containerId = await runChecked(["podman", "kill", this.containerId]);
    // Podman prints the containerId that it killed, if it successfully kills something
    if (this.containerId !== containerId) {
      throw new Error("Podman container cleanup failed!");
    }

    // Clean up any temporary files that was made
    await Deno.remove(this.workDir, { recursive: true });

    this.running = false;
  }
}

async function runChecked(command: Array<string>): Promise<string> {
  const cmd = new Deno.Command(command[0], {
    args: command.slice(1),
    stderr: "piped",
    stdout: "piped",
    stdin: "null",
  });
  const result = await cmd.output();
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (result.code !== 0) {
    throw new Error(
      `Command failed (${result.code}): ${command.join(" ")}\n${stderr || stdout}`,
    );
  }
  if (!stdout) {
    throw new Error(`Command produced no stdout: ${command.join(" ")}`);
  }
  return stdout;
}

async function waitFor(
  condition: () => Promise<boolean>,
  opts: { description: string; timeoutMs: number; intervalMs?: number },
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 100;
  const start = Date.now();

  if (await condition()) return;

  for await (const _ of setInterval(intervalMs)) {
    if (await condition()) return;
    if (Date.now() - start > opts.timeoutMs) {
      throw new Error(`Timeout waiting for ${opts.description}`);
    }
  }
}
