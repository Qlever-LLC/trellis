import { fromFileUrl } from "@std/path";
import { loadConfig } from "../config.ts";

function portalPublicTrellisUrl(): string | undefined {
  const value = loadConfig().web.publicOrigin?.trim();
  return value || undefined;
}

async function main(): Promise<void> {
  const publicTrellisUrl = portalPublicTrellisUrl();

  if (Deno.args.includes("--print-public-trellis-url")) {
    console.log(publicTrellisUrl ?? "");
    return;
  }

  const portalDir = fromFileUrl(
    new URL("../../../portals/login", import.meta.url),
  );

  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", "build:static:prebuilt"],
    cwd: portalDir,
    env: {
      PUBLIC_TRELLIS_URL: publicTrellisUrl ?? "",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const { success, code } = await command.output();
  if (!success) {
    throw new Error(
      `Builtin portal build failed with exit code ${code}.`,
    );
  }
}

await main();
