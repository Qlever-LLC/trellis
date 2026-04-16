import Type from "typebox";
import { defineError } from "@qlever-llc/trellis";

export const ReservedUploadKeyError = defineError({
  type: "ReservedUploadKeyError",
  fields: {
    key: Type.String({ minLength: 1 }),
    reservedPrefix: Type.String({ minLength: 1 }),
  },
  message: ({ reservedPrefix }) =>
    `Upload keys starting with "${reservedPrefix}" are reserved`,
});
