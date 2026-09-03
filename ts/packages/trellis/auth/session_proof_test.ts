import { assertEquals, assertRejects } from "@std/assert";

import { importEd25519PrivateKeyFromSeedBase64url } from "./keys.ts";
import {
  buildSessionProofTranscript,
  parseSessionProof,
  type SessionProofInput,
  sessionProofRequestDigest,
  signSessionProof,
  verifySessionProof,
} from "./session_proof.ts";
import { base64urlEncode, sha256 } from "./utils.ts";

type JsonRecord = Record<string, unknown>;

type VectorCase = {
  name: string;
  purpose: SessionProofInput["purpose"];
  signerPublicKey: string;
  request?: JsonRecord;
  input?: JsonRecord;
  requestDigest: string | null;
  transcriptDigest: string;
  signature: string;
};

type InvalidCase = {
  name: string;
  base: string;
  mutation: string;
  expected: string;
};

type Fixture = {
  identitySeed: string;
  identityPublicKey: string;
  identityKeyId: string;
  identityNkey: string;
  sessionSeed: string;
  sessionPublicKey: string;
  sessionNkey: string;
  cases: VectorCase[];
  invalidCases: InvalidCase[];
};

function field(value: JsonRecord, name: string): string {
  const result = value[name];
  if (typeof result !== "string") {
    throw new Error(`missing vector field ${name}`);
  }
  return result;
}

function time(value: JsonRecord): number {
  const result = value.issuedAt;
  if (typeof result !== "number") throw new Error("missing vector issuedAt");
  return result;
}

function optional(value: JsonRecord, name: string): string | null {
  const result = value[name];
  if (result === null) return null;
  if (typeof result !== "string") {
    throw new Error(`invalid vector field ${name}`);
  }
  return result;
}

function proofSource(vector: VectorCase): JsonRecord {
  const source = vector.request ?? vector.input;
  if (source === undefined) throw new Error(`missing input for ${vector.name}`);
  return source;
}

function vectorInput(
  fixture: Fixture,
  vector: VectorCase,
): SessionProofInput {
  const value = proofSource(vector);
  const common = {
    requestId: field(value, "requestId"),
    issuedAt: time(value),
  };
  switch (vector.purpose) {
    case "userAuthRequest":
      return {
        ...common,
        purpose: vector.purpose,
        sessionPublicKey: field(value, "sessionPublicKey"),
        sessionNkey: field(value, "sessionNkey"),
        participantId: field(value, "participantId"),
        participantDigest: field(value, "participantDigest"),
        redirectTarget: field(value, "redirectTarget"),
        requestDigest: vector.requestDigest ?? "",
      };
    case "userAuthBind":
      return {
        ...common,
        purpose: vector.purpose,
        flowId: field(value, "flowId"),
        sessionPublicKey: field(value, "sessionPublicKey"),
        requestDigest: vector.requestDigest ?? "",
      };
    case "serviceBootstrap":
      return {
        ...common,
        purpose: vector.purpose,
        deploymentId: field(value, "deploymentId"),
        instanceId: field(value, "instanceId"),
        provisionedIdentityKeyId: field(value, "provisionedIdentityKeyId"),
        newSessionPublicKey: field(value, "newSessionPublicKey"),
        newSessionNkey: field(value, "newSessionNkey"),
        participantId: field(value, "participantId"),
        participantDigest: field(value, "participantDigest"),
        requestDigest: vector.requestDigest ?? "",
      };
    case "deviceBootstrap":
      return {
        ...common,
        purpose: vector.purpose,
        deploymentId: field(value, "deploymentId"),
        instanceId: field(value, "instanceId"),
        deviceIdentityKeyId: field(value, "deviceIdentityKeyId"),
        newSessionPublicKey: field(value, "newSessionPublicKey"),
        newSessionNkey: field(value, "newSessionNkey"),
        participantId: field(value, "participantId"),
        participantDigest: field(value, "participantDigest"),
        challengeDigest: optional(value, "challengeDigest"),
        requestDigest: vector.requestDigest ?? "",
      };
    case "authorizationContextRefresh":
      return {
        ...common,
        purpose: vector.purpose,
        sessionId: field(value, "sessionId"),
        sessionKeyId: fixture.identityKeyId,
        currentContextDigest: optional(value, "currentContextDigest"),
        expectedParticipantDigest: optional(value, "expectedParticipantDigest"),
        expectedNeedsDigest: optional(value, "expectedNeedsDigest"),
        knownRootKeyId: field(value, "knownRootKeyId"),
        minimumManifestGeneration: value.minimumManifestGeneration as number,
        requestDigest: vector.requestDigest ?? "",
      };
  }
}

async function fixture(): Promise<Fixture> {
  return JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../conformance/session-proof/vectors.json",
        import.meta.url,
      ),
    ),
  ) as Fixture;
}

Deno.test("shared session-proof vectors match TypeScript", async () => {
  const vectors = await fixture();
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(
    vectors.identitySeed,
  );
  for (const vector of vectors.cases) {
    const source = proofSource(vector);
    if (vector.requestDigest !== null) {
      assertEquals(
        await sessionProofRequestDigest(source),
        vector.requestDigest,
      );
    }
    const input = vectorInput(vectors, vector);
    const proof = parseSessionProof(source.proof);
    assertEquals(
      await signSessionProof(input, privateKey, vector.signerPublicKey),
      proof,
    );
    assertEquals(
      base64urlEncode(await sha256(buildSessionProofTranscript(input))),
      vector.transcriptDigest,
    );
    await verifySessionProof(
      input,
      proof,
      vector.signerPublicKey,
      input.issuedAt,
    );
    assertEquals(proof.signature, vector.signature);
  }
});

Deno.test("shared invalid session-proof vectors fail safely", async () => {
  const vectors = await fixture();
  const find = (name: string): VectorCase => {
    const vector = vectors.cases.find((candidate) => candidate.name === name);
    if (vector === undefined) throw new Error(`missing base vector ${name}`);
    return structuredClone(vector);
  };

  for (const invalid of vectors.invalidCases) {
    const base = find(invalid.base);
    const source = proofSource(base);

    await assertRejects(async () => {
      if (invalid.mutation === "paddedPublicKey") {
        source.sessionPublicKey = `${field(source, "sessionPublicKey")}=`;
      } else if (invalid.mutation === "signature") {
        const proofRecord = source.proof as JsonRecord;
        proofRecord.signature =
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      } else if (invalid.mutation === "identityAsNewSession") {
        source.newSessionPublicKey = vectors.identityPublicKey;
        source.newSessionNkey = vectors.identityNkey;
      } else if (invalid.mutation === "participantDigest") {
        source.participantDigest =
          "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
      } else if (invalid.mutation === "deploymentId") {
        source.deploymentId = `changed-${field(source, "deploymentId")}`;
      } else if (invalid.mutation === "instanceId") {
        source.instanceId = `changed-${field(source, "instanceId")}`;
      } else if (invalid.mutation === "redirectTarget") {
        source.redirectTarget = `changed-${field(source, "redirectTarget")}`;
      } else if (invalid.mutation === "requestId") {
        source.requestId = `changed-${field(source, "requestId")}`;
      }

      let input: SessionProofInput;
      if (invalid.mutation === "devicePurpose") {
        input = {
          ...vectorInput(vectors, base),
          purpose: "deviceBootstrap",
          deviceIdentityKeyId: field(source, "provisionedIdentityKeyId"),
          challengeDigest: null,
        } as SessionProofInput;
      } else {
        input = vectorInput(vectors, base);
      }
      const parsedProof = parseSessionProof(source.proof);
      const now = invalid.mutation === "expiredNow"
        ? input.issuedAt + 30_001
        : invalid.mutation === "futureNow"
        ? input.issuedAt - 30_001
        : input.issuedAt;
      await verifySessionProof(
        input,
        parsedProof,
        base.signerPublicKey,
        now,
      );
    });
  }
});

Deno.test("session-proof boundaries reject cross-language asymmetry", async () => {
  const vectors = await fixture();
  const service = vectors.cases.find((vector) =>
    vector.name === "service-bootstrap"
  );
  if (service === undefined) {
    throw new Error("missing proof vectors");
  }

  const weakSession = vectorInput(vectors, service);
  await assertRejects(async () => {
    await signSessionProof(
      {
        ...weakSession,
        newSessionPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      } as SessionProofInput,
      await importEd25519PrivateKeyFromSeedBase64url(vectors.identitySeed),
      vectors.identityPublicKey,
    );
  });

  const request = structuredClone(proofSource(service));
  request.nonJson = new Date(0);
  await assertRejects(() => sessionProofRequestDigest(request));
  request.nonJson = Array(1);
  await assertRejects(() => sessionProofRequestDigest(request));

  await assertRejects(async () => {
    await signSessionProof(
      { ...weakSession, requestId: "\u0085req" } as SessionProofInput,
      await importEd25519PrivateKeyFromSeedBase64url(vectors.identitySeed),
      vectors.identityPublicKey,
    );
  });
});
