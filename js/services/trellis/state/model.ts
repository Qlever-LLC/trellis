import Type from "typebox";
import {
  type ContractStateKind,
  IsoDateSchema,
  type JsonValue,
  type SchemaLike,
} from "@qlever-llc/trellis/contracts";

export const StoredStateEntrySchema = Type.Object({
  value: Type.Unknown(),
  updatedAt: IsoDateSchema,
  expiresAt: Type.Optional(IsoDateSchema),
  stateVersion: Type.String({ minLength: 1 }),
  writerContractDigest: Type.String({ minLength: 1 }),
});
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
  kind: ContractStateKind;
  schema: SchemaLike;
  stateVersion: string;
  acceptedVersions: Record<string, SchemaLike>;
};
