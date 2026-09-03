import { equal, notDeepEqual } from "node:assert/strict";

import cliParticipant from "../../../rust/crates/trellis/artifacts/trellis.cli.participant.json" with {
  type: "json",
};
import consoleParticipant from "../../.trellis/generated/protocol/participants/trellis-app.console@v1.json" with {
  type: "json",
};
import { nativeProtocolPresentation } from "../../../ts/packages/trellis/contract_support/protocol_artifacts.ts";
import contract from "../../contracts/console/contract.ts";
import {
  buildAdminAccountLoginUrl,
  consumeAdminAccountToken,
} from "./admin_account.ts";

declare const Deno: {
  test(name: string, fn: () => void): void;
};

Deno.test("administrator setup preserves the Console browser flow", () => {
  equal(
    buildAdminAccountLoginUrl(
      "http://localhost:3000/login?flowId=flow_console",
      "secret-token",
      new URL("http://localhost:3000/console/profile"),
    ),
    "http://localhost:3000/login/admin/bootstrap?flowId=secret-token&browserFlowId=flow_console",
  );
  equal(
    buildAdminAccountLoginUrl(
      "/login?flowId=flow_console",
      "secret-token",
      new URL("http://localhost:3000/console/profile"),
    ),
    "http://localhost:3000/login/admin/bootstrap?flowId=secret-token&browserFlowId=flow_console",
  );
  equal(
    buildAdminAccountLoginUrl(
      "/login",
      "secret-token",
      new URL("http://localhost:3000/console/profile"),
    ),
    null,
  );
});

Deno.test("administrator token is removed before Console records its return URL", () => {
  const url = new URL(
    "http://localhost:3000/console/profile?adminAccountToken=secret&tab=account",
  );
  equal(consumeAdminAccountToken(url), "secret");
  equal(
    url.toString(),
    "http://localhost:3000/console/profile?tab=account",
  );
});

Deno.test("Console is separate from the built-in CLI participant", () => {
  const participant = nativeProtocolPresentation(contract).participant;
  equal(participant.id, "trellis-app.console@v1");
  notDeepEqual(
    participant,
    cliParticipant,
  );
});

Deno.test("Console requests every operation behind its route capabilities", () => {
  const required = consoleParticipant.uses.required;
  equal(
    required["trellis.auth@v1"].rpc?.call?.includes("Auth.Users.Resolve"),
    true,
  );
  equal(
    required["trellis.auth@v1"].rpc?.call?.includes(
      "Auth.Devices.ConnectInfo.Get",
    ),
    true,
  );
  equal("trellis.eventlog@v1" in required, true);
});
