import { parseArgs } from "@std/cli/parse-args";
import { resolve, toFileUrl } from "@std/path";

import {
  canonicalizeJson,
  digestJson,
  isJsonValue,
  type JsonValue,
  type TrellisContractV1,
} from "./mod.ts";

type ContractLike = {
  CONTRACT?: unknown;
};

function isContractManifest(value: unknown): value is TrellisContractV1 {
  return isJsonValue(value) && typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).format === "trellis.contract.v1";
}

export async function loadContractFromSource(
  sourcePath: string,
): Promise<TrellisContractV1> {
  const moduleUrl = toFileUrl(resolve(sourcePath)).href;
  const sourceModule = await import(moduleUrl) as Record<string, unknown>;
  const exported = sourceModule.default;

  if (isContractManifest(exported)) {
    return exported;
  }

  if (exported && typeof exported === "object") {
    const contract = (exported as ContractLike).CONTRACT;
    if (isContractManifest(contract)) {
      return contract;
    }
  }

  throw new Error(
    `Source module '${sourcePath}' must default export a Trellis contract or contract module`,
  );
}

export async function emitContractFromSource(
  sourcePath: string,
): Promise<{ contract: TrellisContractV1; canonical: string; digest: string }> {
  const contract = await loadContractFromSource(sourcePath);
  const json = contract as JsonValue;
  const canonical = canonicalizeJson(json);
  const { digest } = await digestJson(json);
  return { contract, canonical, digest };
}

export function parseSourceCliArgs(args: string[]) {
  return parseArgs(args, {
    string: ["source", "out"],
  });
}
