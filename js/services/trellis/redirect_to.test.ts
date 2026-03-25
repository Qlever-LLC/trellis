import { assertEquals } from "@std/assert";

import { validateRedirectTo } from "./redirect_to.ts";

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
    error: "redirectTo must be a relative path or an allowlisted origin",
  });
  assertEquals(validateRedirectTo("///evil.example/", []), {
    ok: false,
    error: "redirectTo must be a relative path or an allowlisted origin",
  });
});

Deno.test("validateRedirectTo rejects non-allowlisted absolute redirects", () => {
  assertEquals(
    validateRedirectTo("https://evil.example/", ["http://localhost:5173"]),
    {
      ok: false,
      error: "redirectTo must be a relative path or an allowlisted origin",
    },
  );
});

Deno.test("validateRedirectTo accepts allowlisted absolute redirects", () => {
  assertEquals(
    validateRedirectTo("http://localhost:5173/", ["http://localhost:5173"]),
    {
      ok: true,
      value: "http://localhost:5173/",
    },
  );
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
