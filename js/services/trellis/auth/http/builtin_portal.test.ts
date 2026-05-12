import { assertEquals } from "@std/assert";
import type { Hono } from "@hono/hono";

import {
  registerBuiltinPortalStaticRoutes,
  serveBuiltinPortalPath,
} from "./builtin_portal.ts";

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
      "/_trellis/portal/users/login",
    );
    assertEquals(await fallback?.text(), "<html>portal</html>");
    assertEquals(
      fallback?.headers.get("content-type"),
      "text/html; charset=utf-8",
    );

    const activationFallback = await serveBuiltinPortalPath(
      root,
      "/_trellis/portal/devices/activate",
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

Deno.test("registerBuiltinPortalStaticRoutes uses TRELLIS_BUILTIN_PORTAL_DIR when no explicit build dir is passed", async () => {
  const root = await Deno.makeTempDir();
  const previous = Deno.env.get("TRELLIS_BUILTIN_PORTAL_DIR");
  try {
    await Deno.writeTextFile(`${root}/200.html`, "<html>override</html>");
    Deno.env.set("TRELLIS_BUILTIN_PORTAL_DIR", root);

    type PortalHandler = (context: {
      req: { path: string };
      body: (body: BodyInit | null, init?: ResponseInit) => Response;
    }) => Promise<Response>;
    const handlers = new Map<string, PortalHandler>();
    const app = {
      get: ((path: string, handler: PortalHandler) => {
        handlers.set(path, handler);
        return app;
      }) as Pick<Hono, "get">["get"],
    };
    registerBuiltinPortalStaticRoutes(app);

    const handler = handlers.get("/_trellis/portal");
    const response = await handler?.({
      req: { path: "/_trellis/portal" },
      body: (body, init) => new Response(body, init),
    });

    assertEquals(await response?.text(), "<html>override</html>");
  } finally {
    if (previous === undefined) {
      Deno.env.delete("TRELLIS_BUILTIN_PORTAL_DIR");
    } else {
      Deno.env.set("TRELLIS_BUILTIN_PORTAL_DIR", previous);
    }
    await Deno.remove(root, { recursive: true });
  }
});
