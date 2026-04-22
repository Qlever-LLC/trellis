import { fromFileUrl } from "@std/path";
import { getConfig } from "../config.ts";

function requirePortalPublicTrellisUrl(): string {
  const value = getConfig().web.publicOrigin?.trim();
  if (!value) {
    throw new Error(
      "config.web.publicOrigin is required to build the builtin portal for `deno task dev`.",
    );
  }

  return value;
}

async function main(): Promise<void> {
  const publicTrellisUrl = requirePortalPublicTrellisUrl();

  if (Deno.args.includes("--print-public-trellis-url")) {
    console.log(publicTrellisUrl);
    return;
  }

  const portalDir = fromFileUrl(
    new URL("../../../portals/login", import.meta.url),
  );

  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", "build:static:prebuilt"],
    cwd: portalDir,
    env: {
      PUBLIC_TRELLIS_URL: publicTrellisUrl,
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
