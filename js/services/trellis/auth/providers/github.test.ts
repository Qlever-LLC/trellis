import { assertEquals } from "@std/assert";
import { Value } from "typebox/value";

// Importing from the provider module keeps the schema in sync with production.
import { __testing__ } from "./github.ts";

Deno.test("GitHub user parsing tolerates missing email and nullable fields", () => {
  const payload = {
    login: "octocat",
    id: 123,
    avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
    name: null,
    company: null,
    location: null,
    email: null,
    updated_at: "2025-12-23T00:00:00Z",
  };

  const user = Value.Parse(__testing__.GitHubUserSchema, payload);
  assertEquals(user.id, 123);
  assertEquals(user.email, null);
});

