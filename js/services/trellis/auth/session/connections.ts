import { base64urlDecode, base64urlEncode } from "@qlever-llc/trellis/auth";

const ENCODED_SCOPE_PREFIX = "b64_";

/** Encodes a connection scope ID into one NATS subject-safe key segment. */
export function encodeConnectionScopeSegment(scopeId: string): string {
  return `${ENCODED_SCOPE_PREFIX}${
    base64urlEncode(new TextEncoder().encode(scopeId))
  }`;
}

/** Decodes an encoded connection scope segment. */
export function decodeConnectionScopeSegment(segment: string): string | null {
  if (!segment.startsWith(ENCODED_SCOPE_PREFIX)) return null;
  const encoded = segment.slice(ENCODED_SCOPE_PREFIX.length);
  if (encoded.length === 0) return null;
  try {
    return new TextDecoder().decode(base64urlDecode(encoded));
  } catch {
    return null;
  }
}

/** Builds the KV key for a live NATS connection. */
export function connectionKey(
  sessionKey: string,
  scopeId: string,
  userNkey: string,
): string {
  return `${sessionKey}.${encodeConnectionScopeSegment(scopeId)}.${userNkey}`;
}

/** Builds a KV filter for all connections under one session key. */
export function connectionFilterForSession(sessionKey: string): string {
  return `${sessionKey}.>`;
}

/** Builds a KV filter for connections for a specific scope ID. */
export function connectionFilterForUser(scopeId: string): string {
  return `*.${encodeConnectionScopeSegment(scopeId)}.*`;
}

/** Builds a KV filter for connections for a specific NATS user key. */
export function connectionFilterForUserNkey(userNkey: string): string {
  return `*.*.${userNkey}`;
}

/** Parses encoded connection keys. */
export function parseConnectionKey(
  key: string,
): { sessionKey: string; scopeId: string; userNkey: string } | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;

  const sessionKey = parts[0];
  const scopeSegment = parts[1];
  const userNkey = parts[2];
  if (!sessionKey || !userNkey) return null;
  if (!scopeSegment) return null;

  const decodedScope = decodeConnectionScopeSegment(scopeSegment);
  if (!decodedScope) return null;
  return {
    sessionKey,
    scopeId: decodedScope,
    userNkey,
  };
}
