import Type from "typebox";
import { TransferGrantSchema } from "@qlever-llc/trellis";

export const FilesInitiateUploadRequest = Type.Object({
  key: Type.String({ minLength: 1 }),
  contentType: Type.Optional(Type.String({ minLength: 1 })),
});

export const FilesInitiateUploadResponse = TransferGrantSchema;
