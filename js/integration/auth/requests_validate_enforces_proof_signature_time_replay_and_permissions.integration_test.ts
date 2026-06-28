import { assert, assertEquals } from "@std/assert";
import {
  AuthError,
  defineAppContract,
  defineServiceContract,
  Result,
  TrellisClient,
} from "@qlever-llc/trellis";
import { isErr } from "@qlever-llc/result";
import {
  base64urlEncode,
  createAuth,
  sha256,
  utf8,
} from "@qlever-llc/trellis/auth";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "../_support/names.ts";

const CASE_ID =
  "auth.requests-validate-enforces-proof-signature-time-replay-and-permissions" as const;

const schemas = {
  ValidateInput: Type.Object({
    sessionKey: Type.String({ minLength: 1 }),
    proof: Type.String({ minLength: 1 }),
    subject: Type.String({ minLength: 1 }),
    payloadHash: Type.String({ minLength: 1 }),
    iat: Type.Integer(),
    requestId: Type.String({ minLength: 1 }),
    capabilities: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  }),
  ProbeOutput: Type.Object({
    ok: Type.Boolean(),
    allowed: Type.Optional(Type.Boolean()),
    reason: Type.Optional(Type.String()),
    callerType: Type.Optional(Type.String()),
    callerCapabilities: Type.Optional(Type.Array(Type.String())),
  }),
} as const;

const probeSubject = caseScopedSubject(
  "rpc.v1.Integration.AuthValidate",
  CASE_ID,
  "Probe",
);

const serviceContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.auth-validate-service",
    CASE_ID,
  ),
  displayName: "Trellis Integration Auth Validate Service",
  description: "Service participant for Auth.Requests.Validate integration.",
  capabilities: {
    ping: {
      displayName: "Ping",
      description: "Call the auth validation test RPC.",
    },
  },
  uses: {
    required: {
      auth: trellisAuth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
    },
  },
  rpc: {
    "Validate.Probe": {
      version: "v1",
      subject: probeSubject,
      input: ref.schema("ValidateInput"),
      output: ref.schema("ProbeOutput"),
      capabilities: { call: ["ping"] },
      errors: [],
    },
  },
}));

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId("trellis.integration.auth-validate-client", CASE_ID),
  displayName: "Trellis Integration Auth Validate Client",
  description: "App participant for Auth.Requests.Validate integration.",
  uses: {
    required: {
      service: serviceContract.use({ rpc: { call: ["Validate.Probe"] } }),
    },
  },
}));

function assertProbeReason(
  result: { ok: boolean; reason?: string },
  reason: string,
) {
  assertEquals(result.ok, false);
  assertEquals(result.reason, reason);
}

liveTrellisTest({
  name:
    "auth.requests-validate-enforces-proof-signature-time-replay-and-permissions validates live request proofs",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = runtime.controlPlane?.sqlite;
    assert(sqlite, "live runtime must expose control-plane SQLite");

    const serviceKey = await runtime.registerService({
      name: caseScopedName("auth-validate-service", CASE_ID),
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: caseScopedName("auth-validate-service", CASE_ID),
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    await service.handle.rpc.validate.probe(async ({ input, client }) => {
      const result = await client.request("Auth.Requests.Validate", input);
      const validation = result.take();
      if (isErr(validation)) {
        return Result.ok({
          ok: false,
          reason: validation.error instanceof AuthError
            ? validation.error.reason
            : validation.error.name,
        });
      }
      return Result.ok({
        ok: true,
        allowed: validation.allowed,
        callerType: validation.caller.type,
        callerCapabilities: validation.caller.capabilities,
      });
    });
    const clientKey = await runtime.registerClient({
      name: caseScopedName("auth-validate-client", CASE_ID),
      contract: clientContract,
    });
    const invokerKey = await runtime.registerClient({
      name: caseScopedName("auth-validate-invoker", CASE_ID),
      contract: clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: caseScopedName("auth-validate-client", CASE_ID),
      contract: clientContract,
      ...clientAuth,
    }).orThrow();
    const invokerAuth = runtime.clientAuth(invokerKey);
    const invoker = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: caseScopedName("auth-validate-invoker", CASE_ID),
      contract: clientContract,
      ...invokerAuth,
    }).orThrow();

    try {
      const appAuth = await createAuth({ sessionKeySeed: clientKey.seed });
      const serviceAuth = await createAuth({ sessionKeySeed: serviceKey.seed });
      const payloadHash = await sha256(utf8("{}"));
      const encodedPayloadHash = base64urlEncode(payloadHash);
      const now = Math.floor(Date.now() / 1000);

      const probe = (input: Parameters<typeof invoker.rpc.validate.probe>[0]) =>
        invoker.rpc.validate.probe(input).orThrow();
      const validateApp = async (
        requestId: string,
        iat = now,
        validateSubject = probeSubject,
      ) =>
        await probe({
          sessionKey: appAuth.sessionKey,
          proof: await appAuth.createProof(
            validateSubject,
            payloadHash,
            requestId,
            iat,
          ),
          subject: validateSubject,
          payloadHash: encodedPayloadHash,
          iat,
          requestId,
        });

      const allowed = await validateApp("req_allowed");
      assertEquals(allowed.ok, true);
      assertEquals(allowed.allowed, true);
      assertEquals(allowed.callerType, "user");

      const deniedSubject = await validateApp(
        "req_denied_subject",
        now,
        "rpc.v1.Integration.AuthValidate.Removed",
      );
      assertEquals(deniedSubject.ok, true);
      assertEquals(deniedSubject.allowed, false);

      const malformedHash = await probe({
        sessionKey: appAuth.sessionKey,
        proof: "not-a-proof",
        subject: probeSubject,
        payloadHash: "!!!!",
        iat: now,
        requestId: "req_malformed_hash",
      });
      assertProbeReason(malformedHash, "invalid_signature");

      const stale = await validateApp("req_stale", now - 60);
      assertProbeReason(stale, "iat_out_of_range");

      const replayInput = {
        sessionKey: appAuth.sessionKey,
        proof: await appAuth.createProof(
          probeSubject,
          payloadHash,
          "req_replay",
          now,
        ),
        subject: probeSubject,
        payloadHash: encodedPayloadHash,
        iat: now,
        requestId: "req_replay",
      };
      const replayFirst = await probe(replayInput);
      assertEquals(replayFirst.ok, true);
      assertEquals(replayFirst.allowed, true);
      const replaySecond = await probe(replayInput);
      assertProbeReason(replaySecond, "invalid_signature");

      const missingSessionInput = {
        sessionKey: appAuth.sessionKey,
        proof: await appAuth.createProof(
          probeSubject,
          payloadHash,
          "req_missing_then_restored",
          now,
        ),
        subject: probeSubject,
        payloadHash: encodedPayloadHash,
        iat: now,
        requestId: "req_missing_then_restored",
      };
      const snapshot = await sqlite.takeSession(clientKey.sessionKey);
      assert(snapshot, "client session row must exist");
      const missing = await probe(missingSessionInput);
      assertProbeReason(missing, "session_not_found");
      await snapshot.restore();
      const restored = await probe(missingSessionInput);
      assertEquals(restored.ok, true);
      assertEquals(restored.allowed, true);

      await sqlite.execute(
        "UPDATE service_instances SET capabilities = ? WHERE instance_key = ?",
        [JSON.stringify(["worker.run"]), serviceKey.sessionKey],
      );
      const servicePayloadHash = await sha256(utf8('{"service":true}'));
      const serviceRequestId = "req_service_current_permissions";
      const serviceValidation = await probe({
        sessionKey: serviceAuth.sessionKey,
        proof: await serviceAuth.createProof(
          probeSubject,
          servicePayloadHash,
          serviceRequestId,
          now,
        ),
        subject: probeSubject,
        payloadHash: base64urlEncode(servicePayloadHash),
        iat: now,
        requestId: serviceRequestId,
        capabilities: ["worker.run"],
      });
      assertEquals(serviceValidation.ok, true);
      assertEquals(serviceValidation.allowed, true);
      assertEquals(serviceValidation.callerType, "service");
      assertEquals(
        serviceValidation.callerCapabilities?.includes("worker.run"),
        true,
      );
    } finally {
      await invoker.connection.close().catch(() => undefined);
      await client.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});
