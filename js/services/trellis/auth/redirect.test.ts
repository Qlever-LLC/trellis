import { assertEquals } from "@std/assert";

import { resolveCorsOrigin, validateRedirectTo } from "./redirect.ts";

Deno.test("validateRedirectTo accepts relative path redirects", () => {
  assertEquals(validateRedirectTo("/", []), { ok: true, value: "/" });
  assertEquals(validateRedirectTo("/foo?bar=baz", []), {
    ok: true,
    value: "/foo?bar=baz",
  });
});

Deno.test("validateRedirectTo rejects scheme-relative redirects", () => {
  assertEquals(validateRedirectTo("//evil.example/", []), {
    ok: false,
    error: "redirectTo must be a relative path or an allowed origin",
  });
  assertEquals(validateRedirectTo("///evil.example/", []), {
    ok: false,
    error: "redirectTo must be a relative path or an allowed origin",
  });
});

Deno.test("validateRedirectTo rejects non-allowed absolute redirects", () => {
  assertEquals(
    validateRedirectTo("https://evil.example/", ["http://localhost:5173"]),
    {
      ok: false,
      error: "redirectTo must be a relative path or an allowed origin",
    },
  );
});

Deno.test("validateRedirectTo accepts explicitly allowed absolute redirects", () => {
  assertEquals(
    validateRedirectTo("http://localhost:5173/", ["http://localhost:5173"]),
    {
      ok: true,
      value: "http://localhost:5173/",
    },
  );
});

Deno.test("validateRedirectTo accepts absolute redirects when wildcard origin is configured", () => {
  assertEquals(validateRedirectTo("https://app.example.com/callback", ["*"]), {
    ok: true,
    value: "https://app.example.com/callback",
  });
});

Deno.test("validateRedirectTo accepts loopback absolute redirects for CLI login", () => {
  assertEquals(validateRedirectTo("http://127.0.0.1:9789/callback", []), {
    ok: true,
    value: "http://127.0.0.1:9789/callback",
  });
  assertEquals(validateRedirectTo("http://localhost:9789/callback", []), {
    ok: true,
    value: "http://localhost:9789/callback",
  });
});

Deno.test("validateRedirectTo rejects non-string values", () => {
  assertEquals(validateRedirectTo(null, []), {
    ok: false,
    error: "Missing redirectTo",
  });
  assertEquals(validateRedirectTo(undefined, []), {
    ok: false,
    error: "Missing redirectTo",
  });
  assertEquals(validateRedirectTo(123, []), {
    ok: false,
    error: "Invalid redirectTo",
  });
});

Deno.test("resolveCorsOrigin echoes request origin for wildcard and explicit matches", () => {
  assertEquals(resolveCorsOrigin("https://app.example.com", ["*"]), "https://app.example.com");
  assertEquals(
    resolveCorsOrigin("https://app.example.com", ["https://app.example.com"]),
    "https://app.example.com",
  );
  assertEquals(
    resolveCorsOrigin("https://app.example.com", ["https://admin.example.com"]),
    undefined,
  );
});
