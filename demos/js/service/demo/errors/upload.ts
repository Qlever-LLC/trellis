import { defineError, TrellisError } from "@qlever-llc/trellis";
import {
  ReservedUploadKeyErrorDataSchema,
  type ReservedUploadKeyErrorData,
} from "../schemas/files.ts";

export class ReservedUploadKeyError extends TrellisError<
  ReservedUploadKeyErrorData
> {
  static readonly schema = ReservedUploadKeyErrorDataSchema;
  override readonly name = "ReservedUploadKeyError" as const;

  readonly key: string;
  readonly reservedPrefix: string;

  constructor(
    options: ErrorOptions & {
      key: string;
      reservedPrefix: string;
      context?: Record<string, unknown>;
      id?: string;
    },
  ) {
    const { key, reservedPrefix, ...baseOptions } = options;
    super(`Upload keys starting with "${reservedPrefix}" are reserved`, baseOptions);
    this.key = key;
    this.reservedPrefix = reservedPrefix;
  }

  static fromSerializable(
    data: ReservedUploadKeyErrorData,
  ): ReservedUploadKeyError {
    return new ReservedUploadKeyError({
      key: data.key,
      reservedPrefix: data.reservedPrefix,
      id: data.id,
      context: data.context,
    });
  }

  override toSerializable(): ReservedUploadKeyErrorData {
    return {
      ...this.baseSerializable(),
      type: this.name,
      key: this.key,
      reservedPrefix: this.reservedPrefix,
    };
  }
}

export const ReservedUploadKey = defineError(ReservedUploadKeyError);
