import Type, { type StaticDecode } from "typebox";

/**
 * Open transport schema for Trellis RPC error payloads.
 *
 * Error payloads must always carry the base error fields, but service-local contract
 * errors may add arbitrary additional properties. The client validates declared local
 * errors against their contract schema before reconstructing runtime `Error` instances.
 */
export const TrellisErrorDataSchema = Type.Object({
  id: Type.String(),
  type: Type.String(),
  message: Type.String(),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String()),
}, { additionalProperties: true });

/**
 * Type for validated transport error data.
 */
export type TrellisErrorData = StaticDecode<typeof TrellisErrorDataSchema>;
