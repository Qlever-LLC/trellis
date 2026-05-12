/** Returns a deterministic Trellis identity id for a provider subject. */
export function identityIdForProviderSubject(
  provider: string,
  subject: string,
): string {
  return `idn_${
    encodeBase64Url(new TextEncoder().encode(`${provider}:${subject}`))
  }`;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}
