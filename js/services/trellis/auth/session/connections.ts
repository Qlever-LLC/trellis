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

/** Builds a KV filter for new-format connections for a specific scope ID. */
export function connectionFilterForUser(scopeId: string): string {
  return `>.${encodeConnectionScopeSegment(scopeId)}.>`;
}

/**
 * A safe subject filter cannot match the last token while allowing an arbitrary
 * number of scope tokens in older raw keys, so callers should scan and parse.
 */
export function connectionFilterForUserNkey(_userNkey: string): null {
  return null;
}

/** Parses both encoded connection keys and legacy raw-scope connection keys. */
export function parseConnectionKey(
  key: string,
): { sessionKey: string; scopeId: string; userNkey: string } | null {
  const parts = key.split(".");
  if (parts.length < 3) return null;

  const sessionKey = parts[0];
  const userNkey = parts[parts.length - 1];
  if (!sessionKey || !userNkey) return null;

  const scopeSegment = parts.slice(1, -1).join(".");
  if (!scopeSegment) return null;

  const decodedScope = decodeConnectionScopeSegment(scopeSegment);
  return {
    sessionKey,
    scopeId: decodedScope ?? scopeSegment,
    userNkey,
  };
}
