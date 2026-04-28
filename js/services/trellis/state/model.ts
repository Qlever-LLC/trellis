import Type, { type StaticDecode } from "typebox";
import type { parseUnknownSchema } from "../../../packages/trellis/codec.ts";

import {
  type JsonValue,
  JsonValueSchema,
  type StateStoreKind,
} from "../../../packages/trellis/models/trellis/State.ts";
import { IsoDateSchema } from "../../../packages/trellis/models/trellis/IsoDate.ts";

export const StoredStateEntrySchema = Type.Object({
  value: JsonValueSchema,
  updatedAt: IsoDateSchema,
  expiresAt: Type.Optional(IsoDateSchema),
  stateVersion: Type.String({ minLength: 1 }),
  writerContractDigest: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type StoredStateEntry = {
  value: JsonValue;
  updatedAt: Date;
  expiresAt?: Date;
  stateVersion: string;
  writerContractDigest: string;
};

export type ResolvedStateStore = {
  ownerType: "user" | "device";
  contractId: string;
  contractDigest: string;
  ownerKey: string;
  store: string;
  kind: StateStoreKind;
  schema: Parameters<typeof parseUnknownSchema>[0];
  stateVersion: string;
  acceptedVersions: Record<string, Parameters<typeof parseUnknownSchema>[0]>;
};
