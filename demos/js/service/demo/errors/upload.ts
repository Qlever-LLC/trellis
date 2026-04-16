import Type from "typebox";
import { defineTrellisErrorClass } from "@qlever-llc/trellis";

export const ReservedUploadKeyError = defineTrellisErrorClass({
  type: "ReservedUploadKeyError",
  fields: {
    key: Type.String({ minLength: 1 }),
    reservedPrefix: Type.String({ minLength: 1 }),
  },
  message: ({ reservedPrefix }) =>
    `Upload keys starting with "${reservedPrefix}" are reserved`,
});

export const ReservedUploadKey = ReservedUploadKeyError.decl;
