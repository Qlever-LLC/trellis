import { join } from "@std/path";

const NATS_BOX_IMAGE = "docker.io/natsio/nats-box:0.19.7";
const WORK_DIR = "/work";

export type ContainerRuntime = "podman" | "docker";

export type LocalNatsBootstrapManifest = {
  accounts: {
    system: { name: string; publicKey: string };
    auth: { name: string; publicKey: string };
    trellis: { name: string; publicKey: string };
  };
  paths: {
    natsConfig: string;
    jwtConfig: string;
    creds: {
      systemService: string;
      authService: string;
      trellisService: string;
      sentinel: string;
    };
    secrets: {
      authIssuerSigning: string;
      authTargetSigning: string;
      authCalloutXKey: string;
    };
  };
};

type GeneratedMetadata = {
  systemAccountName: string;
  systemAccountPublicKey: string;
  authAccountName: string;
  authAccountPublicKey: string;
  trellisAccountName: string;
  trellisAccountPublicKey: string;
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

async function commandSucceeds(
  program: string,
  args: string[],
): Promise<boolean> {
  try {
    const output = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).output();
    return output.success;
  } catch {
    return false;
  }
}

export async function resolveContainerRuntime(): Promise<ContainerRuntime> {
  if (await commandSucceeds("podman", ["--version"])) return "podman";
  if (await commandSucceeds("docker", ["--version"])) return "docker";
  throw new Error("Trellis tests require podman or docker on PATH");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderNatsConfig(serverName: string): string {
  return `server_name: ${serverName}

listen: 0.0.0.0:4222
http: 0.0.0.0:8222

websocket {
  listen: 0.0.0.0:8080
  no_tls: true
}

jetstream {
  store_dir: /data
}

include ./jwt.conf
`;
}

function renderNscScript(): string {
  return `set -eu
OPERATOR_NAME='Qlever'
SYSTEM_ACCOUNT_NAME='SYS'
AUTH_ACCOUNT_NAME='AUTH'
TRELLIS_ACCOUNT_NAME='TRELLIS'
export NSC_HOME=/work/.nsc
export NKEYS_PATH=/work/.nkeys
mkdir -p "$NSC_HOME" "$NKEYS_PATH" /work/data/jwt /work/creds /work/secrets /work/generated

nsc add operator --name "$OPERATOR_NAME" --sys
nsc add account --name "$AUTH_ACCOUNT_NAME"
nsc add account --name "$TRELLIS_ACCOUNT_NAME"
nsc edit account --name "$AUTH_ACCOUNT_NAME" --sk generate
nsc edit account --name "$TRELLIS_ACCOUNT_NAME" --sk generate
nsc edit account --name "$AUTH_ACCOUNT_NAME" --js-mem-storage -1 --js-disk-storage -1 --js-streams -1 --js-consumer -1
nsc edit account --name "$TRELLIS_ACCOUNT_NAME" --js-mem-storage -1 --js-disk-storage -1 --js-streams -1 --js-consumer -1

nsc add user --account "$SYSTEM_ACCOUNT_NAME" --name system --allow-pubsub ">"
nsc add user --account "$AUTH_ACCOUNT_NAME" --name auth --allow-pubsub ">"
nsc add user --account "$TRELLIS_ACCOUNT_NAME" --name auth --allow-pubsub ">"
nsc add user --account "$AUTH_ACCOUNT_NAME" --name sentinel --deny-pubsub ">"

AUTH_USER=$(nsc describe user --account "$AUTH_ACCOUNT_NAME" --name auth --field sub | tr -d '"')
TRELLIS_ACCOUNT=$(nsc describe account --name "$TRELLIS_ACCOUNT_NAME" --field sub | tr -d '"')
nsc edit authcallout --account "$AUTH_ACCOUNT_NAME" --auth-user "$AUTH_USER" --allowed-account "$TRELLIS_ACCOUNT" --curve generate

nsc generate creds --account "$AUTH_ACCOUNT_NAME" --name auth > /work/creds/auth-auth.creds
nsc generate creds --account "$TRELLIS_ACCOUNT_NAME" --name auth > /work/creds/trellis-auth.creds
nsc generate creds --account "$AUTH_ACCOUNT_NAME" --name sentinel > /work/creds/sentinel.creds
nsc generate creds --account "$SYSTEM_ACCOUNT_NAME" --name system > /work/creds/system.creds

SYS_ACCOUNT=$(nsc describe account --name "$SYSTEM_ACCOUNT_NAME" --field sub | tr -d '"')
AUTH_ACCOUNT=$(nsc describe account --name "$AUTH_ACCOUNT_NAME" --field sub | tr -d '"')
TRELLIS_ACCOUNT=$(nsc describe account --name "$TRELLIS_ACCOUNT_NAME" --field sub | tr -d '"')

nsc describe account --name "$SYSTEM_ACCOUNT_NAME" --raw > "/work/data/jwt/\${SYS_ACCOUNT}.jwt"
nsc describe account --name "$AUTH_ACCOUNT_NAME" --raw > "/work/data/jwt/\${AUTH_ACCOUNT}.jwt"
nsc describe account --name "$TRELLIS_ACCOUNT_NAME" --raw > "/work/data/jwt/\${TRELLIS_ACCOUNT}.jwt"
nsc generate config --nats-resolver --config-file /work/generated/jwt.conf --force --sys-account "$SYSTEM_ACCOUNT_NAME"

nsc list keys --account "$AUTH_ACCOUNT_NAME" --accounts --show-seeds --json > /work/generated/auth-keys.json
nsc list keys --account "$TRELLIS_ACCOUNT_NAME" --accounts --show-seeds --json > /work/generated/trellis-keys.json

cat > /work/generated/metadata.json <<EOF
{
  "systemAccountName": "\${SYSTEM_ACCOUNT_NAME}",
  "systemAccountPublicKey": "\${SYS_ACCOUNT}",
  "authAccountName": "\${AUTH_ACCOUNT_NAME}",
  "authAccountPublicKey": "\${AUTH_ACCOUNT}",
  "trellisAccountName": "\${TRELLIS_ACCOUNT_NAME}",
  "trellisAccountPublicKey": "\${TRELLIS_ACCOUNT}"
}
EOF
`;
}

function containerMount(path: string, runtime: ContainerRuntime): string {
  return `${path}:${WORK_DIR}${runtime === "podman" ? ":Z" : ""}`;
}

async function runChecked(program: string, args: string[]): Promise<void> {
  const result = await new Deno.Command(program, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (result.success) return;
  const stderr = new TextDecoder().decode(result.stderr).trim();
  const stdout = new TextDecoder().decode(result.stdout).trim();
  throw new Error(
    `${program} ${args.join(" ")} failed with status ${result.code}: ${
      stderr || stdout
    }`,
  );
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectSeeds(
  value: JsonValue,
  prefix: string,
  signing: boolean,
  curve: boolean,
  out: string[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSeeds(item, prefix, signing, curve, out);
    return;
  }
  if (!isRecord(value)) return;
  if (
    typeof value.seed === "string" && value.seed.startsWith(prefix) &&
    value.signing === signing && value.curve === curve
  ) {
    out.push(value.seed);
  }
  for (const item of Object.values(value)) {
    collectSeeds(item, prefix, signing, curve, out);
  }
}

async function firstSeedMatching(
  path: string,
  prefix: string,
  signing: boolean,
  curve: boolean,
  label: string,
): Promise<string> {
  const value = JSON.parse(await Deno.readTextFile(path)) as JsonValue;
  const seeds: string[] = [];
  collectSeeds(value, prefix, signing, curve, seeds);
  const seed = seeds[0];
  if (!seed) throw new Error(`missing generated ${label}`);
  return seed;
}

function normalizeJwtConfig(config: string): string {
  return config.replaceAll(WORK_DIR, "/data")
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("dir:") || trimmed.startsWith("dir ")) {
        return `${line.slice(0, line.length - trimmed.length)}dir: /data/jwt`;
      }
      return line;
    })
    .join("\n") + "\n";
}

/** Generates isolated NATS account, credential, and auth-callout files. */
export async function generateLocalNatsBootstrap(args: {
  outDir: string;
  runtime: ContainerRuntime;
}): Promise<LocalNatsBootstrapManifest> {
  await Deno.mkdir(join(args.outDir, "data", "jwt"), { recursive: true });
  await Deno.mkdir(join(args.outDir, "creds"), { recursive: true });
  await Deno.mkdir(join(args.outDir, "secrets"), { recursive: true });
  await Deno.mkdir(join(args.outDir, "generated"), { recursive: true });
  await Deno.writeTextFile(
    join(args.outDir, "nats.conf"),
    renderNatsConfig("trellis-test"),
  );
  await Deno.writeTextFile(
    join(args.outDir, "bootstrap-nsc.sh"),
    renderNscScript(),
  );

  await runChecked(args.runtime, [
    "run",
    "--rm",
    "-v",
    containerMount(args.outDir, args.runtime),
    NATS_BOX_IMAGE,
    "sh",
    "/work/bootstrap-nsc.sh",
  ]);

  await Deno.writeTextFile(
    join(args.outDir, "secrets", "auth-issuer-signing.seed"),
    await firstSeedMatching(
      join(args.outDir, "generated", "auth-keys.json"),
      "SA",
      true,
      false,
      "auth issuer signing seed",
    ),
  );
  await Deno.writeTextFile(
    join(args.outDir, "secrets", "auth-target-signing.seed"),
    await firstSeedMatching(
      join(args.outDir, "generated", "trellis-keys.json"),
      "SA",
      true,
      false,
      "auth target signing seed",
    ),
  );
  await Deno.writeTextFile(
    join(args.outDir, "secrets", "auth-sx.seed"),
    await firstSeedMatching(
      join(args.outDir, "generated", "auth-keys.json"),
      "SX",
      false,
      true,
      "auth callout xkey seed",
    ),
  );
  await Deno.writeTextFile(
    join(args.outDir, "jwt.conf"),
    normalizeJwtConfig(
      await Deno.readTextFile(join(args.outDir, "generated", "jwt.conf")),
    ),
  );

  const metadata = JSON.parse(
    await Deno.readTextFile(join(args.outDir, "generated", "metadata.json")),
  ) as GeneratedMetadata;
  await Deno.remove(join(args.outDir, "generated"), { recursive: true });
  await Deno.remove(join(args.outDir, "bootstrap-nsc.sh"));

  return {
    accounts: {
      system: {
        name: metadata.systemAccountName,
        publicKey: metadata.systemAccountPublicKey,
      },
      auth: {
        name: metadata.authAccountName,
        publicKey: metadata.authAccountPublicKey,
      },
      trellis: {
        name: metadata.trellisAccountName,
        publicKey: metadata.trellisAccountPublicKey,
      },
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

export function quoteForDisplay(value: string): string {
  return shellQuote(value);
}
