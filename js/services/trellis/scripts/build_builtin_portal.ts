import { fromFileUrl } from "@std/path";

async function main(): Promise<void> {
  if (Deno.args.includes("--print-public-trellis-url")) {
    console.log("");
    return;
  }

  const portalDir = fromFileUrl(
    new URL("../../../portals/login", import.meta.url),
  );

  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", "build:static:prebuilt"],
    cwd: portalDir,
    env: {
      PUBLIC_TRELLIS_URL: "",
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
