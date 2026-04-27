import { assertEquals } from "@std/assert";

Deno.test("auth HTTP routes do not register removed legacy auth endpoints", async () => {
  const routesSource = await Deno.readTextFile(
    new URL("./routes.ts", import.meta.url),
  );

  assertEquals(routesSource.includes('app.post("/auth/requests"'), true);
  assertEquals(
    routesSource.includes('app.post("/auth/flow/:flowId/bind"'),
    true,
  );
  assertEquals(routesSource.includes('app.get("/auth/login"'), false);
  assertEquals(routesSource.includes('app.post("/auth/bind"'), false);
});

Deno.test("auth HTTP approval route only accepts approved boolean request shape", async () => {
  const routesSource = await Deno.readTextFile(
    new URL("./routes.ts", import.meta.url),
  );

  assertEquals(
    routesSource.includes("parseApprovalRequest(bodyResult.take())"),
    true,
  );
  assertEquals(routesSource.includes("body.decision"), false);
});
