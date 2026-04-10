import type { Hono } from "@hono/hono";
import { dirname, extname, fromFileUrl, resolve } from "@std/path";

// Service sources live under `js/services/trellis/auth/http`, while the built
// portal is copied into `js/portals/login/build` in the runtime image.
const DEFAULT_BUILD_DIR = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../../../../portals/login/build",
);
const PORTAL_PREFIX = "/_trellis/portal";
const PORTAL_APP_PREFIX = "/_trellis/assets";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function toFilePath(rootDir: string, pathname: string): string | null {
  const normalizedRoot = resolve(rootDir);
  const candidate = resolve(normalizedRoot, `.${pathname}`);
  if (
    candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`)
  ) {
    return candidate;
  }
  return null;
}

async function readFileResponse(filePath: string): Promise<Response | null> {
  try {
    const data = await Deno.readFile(filePath);
    const headers = new Headers();
    const contentType = CONTENT_TYPES[extname(filePath)];
    if (contentType) headers.set("content-type", contentType);
    return new Response(data, { headers });
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.IsADirectory
    ) {
      return null;
    }
    throw error;
  }
}

export async function serveBuiltinPortalPath(
  buildDir: string,
  pathname: string,
): Promise<Response | null> {
  const filePath = toFilePath(buildDir, pathname);
  if (!filePath) return null;

  if (pathname.startsWith(`${PORTAL_APP_PREFIX}/`)) {
    return await readFileResponse(filePath);
  }

  if (pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`)) {
    const direct = await readFileResponse(filePath);
    if (direct) return direct;
    const fallbackPath = toFilePath(buildDir, "/200.html");
    return fallbackPath ? await readFileResponse(fallbackPath) : null;
  }

  return null;
}

export function registerBuiltinPortalStaticRoutes(
  app: Pick<Hono, "get">,
  options: { buildDir?: string } = {},
): void {
  const buildDir = options.buildDir ?? DEFAULT_BUILD_DIR;
  const handler = async (
    c: {
      req: { path: string };
      body: (body: BodyInit | null, init?: ResponseInit) => Response;
    },
  ) => {
    const response = await serveBuiltinPortalPath(buildDir, c.req.path);
    if (!response) {
      return c.body(null, { status: 404 });
    }

    return c.body(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };

  app.get(PORTAL_PREFIX, handler);
  app.get(`${PORTAL_PREFIX}/*`, handler);
  app.get(`${PORTAL_APP_PREFIX}/*`, handler);
}
