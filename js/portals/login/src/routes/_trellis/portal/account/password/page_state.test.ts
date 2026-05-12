import { assertEquals } from "@std/assert";

import {
  defaultProfileValue,
  hasLocalProvider,
  isExpectedPasswordFlow,
  parseAccountFlowState,
  passwordFlowAction,
  passwordFlowTitle,
} from "./page_state.ts";

Deno.test("password adapts setup and reset copy", () => {
  assertEquals(passwordFlowTitle("local_password_setup"), "Set your password");
  assertEquals(passwordFlowAction("local_password_setup"), "Set password");
  assertEquals(
    passwordFlowTitle("local_password_reset"),
    "Reset your password",
  );
  assertEquals(passwordFlowAction("local_password_reset"), "Reset password");
});

Deno.test("password recognizes setup and reset flows", () => {
  const state = parseAccountFlowState({
    status: "active",
    flowId: "flow-1",
    kind: "local_password_reset",
    targetUserId: "usr_1",
    allowedProviders: ["local"],
    profileHint: { name: "Hint Name", email: "hint@example.com" },
    expiresAt: "2099-01-01T00:00:00.000Z",
    providers: [{ id: "local", displayName: "Username and password" }],
    target: { userId: "usr_1", email: "target@example.com", active: true },
  });

  assertEquals(state.status, "active");
  if (state.status === "active") {
    assertEquals(isExpectedPasswordFlow(state), true);
    assertEquals(hasLocalProvider(state), true);
    assertEquals(defaultProfileValue(state, "name"), "Hint Name");
    assertEquals(defaultProfileValue(state, "email"), "target@example.com");
  }
});
