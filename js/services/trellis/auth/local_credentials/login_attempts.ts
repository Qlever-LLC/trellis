import type { LocalCredential } from "../schemas.ts";

const LOCAL_LOGIN_FAILURE_THRESHOLD = 5;
const LOCAL_LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/** Returns whether a local credential is currently locked out. */
export function isLocalCredentialLocked(
  credential: LocalCredential,
  now: Date,
): boolean {
  return credential.lockedUntil !== null &&
    new Date(credential.lockedUntil).getTime() > now.getTime();
}

/** Records one failed local login attempt and locks at the configured threshold. */
export function recordLocalCredentialLoginFailure(
  credential: LocalCredential,
  now: Date,
): LocalCredential {
  const failedLoginCount = credential.failedLoginCount + 1;
  return {
    ...credential,
    failedLoginCount,
    lockedUntil: failedLoginCount >= LOCAL_LOGIN_FAILURE_THRESHOLD
      ? new Date(now.getTime() + LOCAL_LOGIN_LOCKOUT_MS).toISOString()
      : credential.lockedUntil,
    updatedAt: now.toISOString(),
  };
}

/** Clears local login failure state after a valid password. */
export function resetLocalCredentialLoginFailures(
  credential: LocalCredential,
  now: Date,
): LocalCredential {
  return {
    ...credential,
    failedLoginCount: 0,
    lockedUntil: null,
    updatedAt: now.toISOString(),
  };
}
