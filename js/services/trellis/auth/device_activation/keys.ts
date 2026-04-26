function encodeKeyPart(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = "";
  for (const byte of bytes) {
    const isAlphaNum = (byte >= 48 && byte <= 57) ||
      (byte >= 65 && byte <= 90) ||
      (byte >= 97 && byte <= 122);
    if (isAlphaNum || byte === 45 || byte === 95) {
      encoded += String.fromCharCode(byte);
      continue;
    }
    encoded += `~${byte.toString(16).padStart(2, "0")}`;
  }
  return encoded;
}

export function deviceActivationRecordKey(
  input: { instanceId: string; publicIdentityKey: string },
): string {
  return [
    "instance",
    encodeKeyPart(input.instanceId),
    "identity",
    encodeKeyPart(input.publicIdentityKey),
  ].join(".");
}

export function deviceActivationByIdentityPattern(
  publicIdentityKey: string,
): string {
  return `instance.*.identity.${encodeKeyPart(publicIdentityKey)}`;
}
