import type { User } from "@nats-io/jwt";

/**
 * Bounded multi-response allowance for streamed operation replies.
 */
export const OPERATION_RESPONSE_MAX = 65_535;
const UNARY_RESPONSE_MAX = 1;
type AuthCalloutSessionType = "device" | "service" | "user";

type BuildAuthCalloutPermissionsArgs = {
  publishAllow: string[];
  subscribeAllow: string[];
  inboxPrefix: string;
  issuerAccount: string;
  sessionType: AuthCalloutSessionType;
};

/**
 * Builds NATS permissions for Trellis auth-callout-issued sessions.
 */
export function buildAuthCalloutPermissions(
  args: BuildAuthCalloutPermissionsArgs,
): Partial<User> {
  return {
    pub: {
      allow: [...new Set(args.publishAllow)],
    },
    resp: {
      max: args.sessionType === "service"
        ? OPERATION_RESPONSE_MAX
        : UNARY_RESPONSE_MAX,
    },
    sub: {
      allow: [...new Set([...args.subscribeAllow, `${args.inboxPrefix}.>`])],
    },
    locale: Intl.DateTimeFormat().resolvedOptions().timeZone,
    data: 100 * 1000000,
    subs: 1500,
    issuer_account: args.issuerAccount,
  };
}
