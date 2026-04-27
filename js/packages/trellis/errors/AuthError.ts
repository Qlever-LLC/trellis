import Type, { type Static } from "typebox";
import { TrellisError } from "./TrellisError.ts";

export const AuthErrorDataSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal("AuthError"),
  message: Type.String(),
  reason: Type.Union([
    Type.Literal("invalid_request"),
    Type.Literal("missing_session_key"),
    Type.Literal("missing_proof"),
    Type.Literal("session_not_found"),
    Type.Literal("session_expired"),
    Type.Literal("invalid_signature"),
    Type.Literal("user_not_found"),
    Type.Literal("user_inactive"),
    Type.Literal("unknown_device"),
    Type.Literal("device_deployment_not_found"),
    Type.Literal("device_deployment_disabled"),
    Type.Literal("device_activation_revoked"),
    Type.Literal("unknown_service"),
    Type.Literal("service_disabled"),
    Type.Literal("iat_out_of_range"),
    Type.Literal("invalid_binding_token"),
    Type.Literal("session_corrupted"),
    Type.Literal("session_already_bound"),
    Type.Literal("authtoken_already_used"),
    Type.Literal("oauth_session_key_mismatch"),
    Type.Literal("service_role_on_user"),
    Type.Literal("reply_subject_mismatch"),
    Type.Literal("insufficient_permissions"),
    Type.Literal("forbidden"),
    Type.Literal("missing_flow_id"),
    Type.Literal("device_activation_flow_not_found"),
    Type.Literal("device_activation_flow_expired"),
    Type.Literal("device_activation_rejected"),
    Type.Literal("device_identity_key_mismatch"),
    Type.Literal("invalid_device_qr_mac"),
  ]),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String()),
});
export type AuthErrorData = Static<typeof AuthErrorDataSchema>;

/**
 * Error for authentication and authorization failures.
 */
export class AuthError extends TrellisError<AuthErrorData> {
  override readonly name = "AuthError" as const;
  readonly reason: AuthErrorData["reason"];

  constructor(
    options: ErrorOptions & {
      reason: AuthErrorData["reason"];
      context?: Record<string, unknown>;
      id?: string;
    },
  ) {
    const { reason, ...baseOptions } = options;
    super(`Auth failed: ${reason}`, baseOptions);
    this.reason = reason;
  }

  /**
   * Serializes error to a plain object.
   *
   * @returns Plain object representation of the error
   */
  override toSerializable(): AuthErrorData {
    return {
      ...this.baseSerializable(),
      type: this.name,
      reason: this.reason,
    } as AuthErrorData;
  }
}
