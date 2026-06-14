import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  buildControlPlaneConfig,
  writeTrellisConfig,
} from "../src/control_plane_config.ts";
import type { LocalNatsBootstrapManifest } from "../src/nats_bootstrap.ts";

function testManifest(): LocalNatsBootstrapManifest {
  return {
    accounts: {
      system: { name: "SYS", publicKey: "SYS_PUBLIC" },
      auth: { name: "AUTH", publicKey: "AUTH_PUBLIC" },
      trellis: { name: "TRELLIS", publicKey: "TRELLIS_PUBLIC" },
    },
    paths: {
      natsConfig: "nats.conf",
      jwtConfig: "jwt.conf",
      creds: {
        systemService: "creds/system.creds",
        authService: "creds/auth-auth.creds",
        trellisService: "creds/trellis-auth.creds",
        sentinel: "creds/sentinel.creds",
      },
      secrets: {
        authIssuerSigning: "secrets/auth-issuer-signing.seed",
        authTargetSigning: "secrets/auth-target-signing.seed",
        authCalloutXKey: "secrets/auth-sx.seed",
      },
    },
  };
}

Deno.test("writeTrellisConfig writes file-backed test control-plane config", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "trellis-config-test-" });
  try {
    const natsDir = join(workdir, "nats");
    await Deno.mkdir(join(natsDir, "secrets"), { recursive: true });
    await Deno.writeTextFile(
      join(natsDir, "secrets", "auth-issuer-signing.seed"),
      "issuer-seed\n",
    );
    await Deno.writeTextFile(
      join(natsDir, "secrets", "auth-target-signing.seed"),
      "target-seed\n",
    );
    await Deno.writeTextFile(
      join(natsDir, "secrets", "auth-sx.seed"),
      "sx-seed\n",
    );

    const config = buildControlPlaneConfig({
      workdir,
      natsUrl: "nats://127.0.0.1:4222",
      websocketUrl: "ws://127.0.0.1:8080",
      manifest: testManifest(),
      port: 3000,
    });
    const configPath = await writeTrellisConfig({ workdir, config });
    const text = await Deno.readTextFile(configPath);

    assertEquals(configPath, join(workdir, "trellis", "config.jsonc"));
    assertEquals(config.logLevel, "info");
    assertStringIncludes(
      text,
      `"dbPath": "${join(workdir, "trellis", "trellis.sqlite")}"`,
    );
    assertStringIncludes(
      text,
      `"credsPath": "${join(workdir, "nats", "creds/system.creds")}"`,
    );
    assertStringIncludes(text, `"signing": "issuer-seed"`);
    assertStringIncludes(text, `"sxSeed": "sx-seed"`);
  } finally {
    await Deno.remove(workdir, { recursive: true }).catch(() => undefined);
  }
});
