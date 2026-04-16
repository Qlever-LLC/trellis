import Type, { type Static } from "typebox";
import { TransferGrantSchema } from "@qlever-llc/trellis";

export const FilesInitiateUploadRequest = Type.Object({
  key: Type.String({ minLength: 1 }),
  contentType: Type.Optional(Type.String({ minLength: 1 })),
});

export const FilesInitiateUploadResponse = TransferGrantSchema;

export const ReservedUploadKeyErrorDataSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal("ReservedUploadKeyError"),
  message: Type.String(),
  key: Type.String({ minLength: 1 }),
  reservedPrefix: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String()),
});

export type ReservedUploadKeyErrorData = Static<
  typeof ReservedUploadKeyErrorDataSchema
>;
