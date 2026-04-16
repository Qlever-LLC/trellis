import {
  base64urlDecode,
  base64urlEncode,
  sha256,
  toArrayBuffer,
  utf8,
} from "./utils.ts";
import { importEd25519PublicKeyFromBase64url } from "./keys.ts";
import { AsyncResult } from "@qlever-llc/result";

export type ProofParams = {
  sessionKey: string;
  subject: string;
  payloadHash: Uint8Array;
};

export function buildProofInput(
  sessionKey: string,
  subject: string,
  payloadHash: Uint8Array,
): Uint8Array {
  const sessionKeyBytes = utf8(sessionKey);
  const subjectBytes = utf8(subject);

  const buf = new Uint8Array(
    4 +
      sessionKeyBytes.length +
      4 +
      subjectBytes.length +
      4 +
      payloadHash.length,
  );
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, sessionKeyBytes.length);
  offset += 4;
  buf.set(sessionKeyBytes, offset);
  offset += sessionKeyBytes.length;

  view.setUint32(offset, subjectBytes.length);
  offset += 4;
  buf.set(subjectBytes, offset);
  offset += subjectBytes.length;

  view.setUint32(offset, payloadHash.length);
  offset += 4;
  buf.set(payloadHash, offset);

  return buf;
}

export async function createProof(
  privateKey: CryptoKey,
  params: ProofParams,
): Promise<string> {
  const input = buildProofInput(
    params.sessionKey,
    params.subject,
    params.payloadHash,
  );
  const digest = await sha256(input);
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    toArrayBuffer(digest),
  );
  return base64urlEncode(new Uint8Array(sig));
}

export async function verifyProof(
  publicSessionKey: string,
  params: ProofParams,
  proofBase64url: string,
): Promise<boolean> {
  const result = await AsyncResult.try(async () => {
    const input = buildProofInput(
      params.sessionKey,
      params.subject,
      params.payloadHash,
    );
    const digest = await sha256(input);
    const signature = base64urlDecode(proofBase64url);
    const pub = await importEd25519PublicKeyFromBase64url(publicSessionKey);
    return crypto.subtle.verify(
      { name: "Ed25519" },
      pub,
      toArrayBuffer(signature),
      toArrayBuffer(digest),
    );
  });
  return result.unwrapOr(false);
}
