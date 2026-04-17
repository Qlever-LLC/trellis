import Type from "typebox";
import { UploadTransferGrantSchema } from "@qlever-llc/trellis";

const OperationStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const OperationRefSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  service: Type.String({ minLength: 1 }),
  operation: Type.String({ minLength: 1 }),
});

export const FilesProcessStartRequest = Type.Object({
  key: Type.String({ minLength: 1 }),
  contentType: Type.Optional(Type.String({ minLength: 1 })),
});

export const FilesProcessProgress = Type.Object({
  stage: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
});

export const FilesProcessJobPayload = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  key: Type.String({ minLength: 1 }),
});

export const FilesProcessResult = Type.Object({
  key: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 0 }),
  tempFilePath: Type.String({ minLength: 1 }),
});

export const FilesProcessAcceptedSnapshot = Type.Object({
  id: Type.String({ minLength: 1 }),
  service: Type.String({ minLength: 1 }),
  operation: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 1 }),
  state: OperationStateSchema,
  createdAt: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 }),
  completedAt: Type.Optional(Type.String({ minLength: 1 })),
  progress: Type.Optional(FilesProcessProgress),
  output: Type.Optional(FilesProcessResult),
  error: Type.Optional(Type.Object({
    type: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  })),
});

export const FilesProcessStartResponse = Type.Object({
  transfer: UploadTransferGrantSchema,
  operation: Type.Object({
    ref: OperationRefSchema,
    snapshot: FilesProcessAcceptedSnapshot,
  }),
});
