import {
  base64urlDecode,
  base64urlEncode,
  sha256,
  toArrayBuffer,
  utf8,
} from "@qlever-llc/trellis/auth";
import { AsyncResult } from "@qlever-llc/result";

export function randomToken(bytes: number): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashKey(value: string): Promise<string> {
  return base64urlEncode(await sha256(utf8(value)));
}

export async function verifyDomainSig(
  sessionKey: string,
  prefix: string,
  value: string,
  sigBase64url: string,
): Promise<boolean> {
  const result = await AsyncResult.try(async () => {
    const digest = await sha256(utf8(`${prefix}:${value}`));
    const pubRaw = base64urlDecode(sessionKey);
    if (pubRaw.length !== 32) return false;

    const pub = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(pubRaw),
      { name: "Ed25519" },
      true,
      ["verify"],
    );

    const sig = base64urlDecode(sigBase64url);
    if (sig.length !== 64) return false;

    return crypto.subtle.verify(
      { name: "Ed25519" },
      pub,
      toArrayBuffer(sig),
      toArrayBuffer(digest),
    );
  });
  return result.unwrapOr(false);
}
