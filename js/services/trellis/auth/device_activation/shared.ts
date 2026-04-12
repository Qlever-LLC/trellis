const DEFAULT_DEVICE_PROOF_IAT_SKEW_SECONDS = 30;

export function isDeviceProofIatFresh(
  iat: number,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  skewSeconds: number = DEFAULT_DEVICE_PROOF_IAT_SKEW_SECONDS,
): boolean {
  return Math.abs(nowSeconds - iat) <= skewSeconds;
}
