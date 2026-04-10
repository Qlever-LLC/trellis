import { assertEquals } from "@std/assert";

import { serveBuiltinPortalPath } from "./builtin_portal.ts";

Deno.test("serveBuiltinPortalPath serves portal asset files and SPA fallback", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/_trellis/assets/immutable`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/_trellis/assets/immutable/app.js`,
      "console.log('portal')",
    );
    await Deno.writeTextFile(`${root}/200.html`, "<html>portal</html>");

    const asset = await serveBuiltinPortalPath(
      root,
      "/_trellis/assets/immutable/app.js",
    );
    assertEquals(await asset?.text(), "console.log('portal')");
    assertEquals(
      asset?.headers.get("content-type"),
      "text/javascript; charset=utf-8",
    );

    const fallback = await serveBuiltinPortalPath(
      root,
      "/_trellis/portal/login",
    );
    assertEquals(await fallback?.text(), "<html>portal</html>");
    assertEquals(
      fallback?.headers.get("content-type"),
      "text/html; charset=utf-8",
    );

    const activationFallback = await serveBuiltinPortalPath(
      root,
      "/_trellis/portal/activate",
    );
    assertEquals(await activationFallback?.text(), "<html>portal</html>");
    assertEquals(
      activationFallback?.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("serveBuiltinPortalPath rejects traversal and unrelated paths", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${root}/200.html`, "<html>portal</html>");

    assertEquals(
      await serveBuiltinPortalPath(root, "/_trellis/assets/../../etc/passwd"),
      null,
    );
    assertEquals(await serveBuiltinPortalPath(root, "/auth/login"), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
