import type {
  ContractEvent,
  ContractOperation,
  ContractRpcMethod,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import {
  resolveContractUsesFromStore,
  sortUniqueStrings,
  templateToWildcard,
} from "../../catalog/uses.ts";
import { operationControlCapabilityRules } from "../../catalog/permissions.ts";
import type { ContractStore } from "../../catalog/store.ts";
import type { ContractApproval } from "../schemas.ts";

export type UserContractApprovalPlan = {
  digest: string;
  contract: TrellisContractV1;
  approval: ContractApproval;
  publishSubjects: string[];
  subscribeSubjects: string[];
};

const TRANSFER_UPLOAD_SUBJECT = "transfer.v1.upload.*.*";
const TRANSFER_DOWNLOAD_SUBJECT = "transfer.v1.download.*.*";

export async function planUserContractApproval(
  contractStore: ContractStore,
  rawContract: unknown,
): Promise<UserContractApprovalPlan> {
  const validated = await contractStore.validate(rawContract);
  const uses = resolveContractUsesFromStore(contractStore, validated.contract);
  if (
    validated.contract.kind !== "app" && validated.contract.kind !== "agent"
  ) {
    throw new Error(
      `User approval requires an app or agent contract, got ${validated.contract.kind}`,
    );
  }
  const publishSubjects = new Set<string>();
  const subscribeSubjects = new Set<string>();
  const capabilities = new Set<string>();

  for (
    const event of Object.values<ContractEvent>(validated.contract.events ?? {})
  ) {
    publishSubjects.add(templateToWildcard(event.subject));
    for (const capability of event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const method of uses.rpcCalls) {
    publishSubjects.add(templateToWildcard(method.method.subject));
    if (method.method.transfer?.direction === "receive") {
      subscribeSubjects.add(TRANSFER_DOWNLOAD_SUBJECT);
    }
    for (const capability of method.method.capabilities?.call ?? []) {
      capabilities.add(capability);
    }
  }

  for (const operation of uses.operationCalls) {
    publishSubjects.add(templateToWildcard(operation.operation.subject));
    const operationControlRules = operationControlCapabilityRules(
      operation.operation,
    );
    if (operationControlRules.length > 0) {
      publishSubjects.add(
        templateToWildcard(`${operation.operation.subject}.control`),
      );
    }
    if (operation.operation.transfer?.direction === "send") {
      publishSubjects.add(TRANSFER_UPLOAD_SUBJECT);
    }
    for (const capability of operation.operation.capabilities?.call ?? []) {
      capabilities.add(capability);
    }
    for (const requiredCapabilities of operationControlRules) {
      for (const capability of requiredCapabilities) {
        capabilities.add(capability);
      }
    }
  }

  for (
    const method of Object.values<ContractRpcMethod>(
      validated.contract.rpc ?? {},
    )
  ) {
    if (method.transfer?.direction === "receive") {
      subscribeSubjects.add(TRANSFER_DOWNLOAD_SUBJECT);
    }
  }

  for (
    const operation of Object.values<ContractOperation>(
      validated.contract.operations ?? {},
    )
  ) {
    if (operation.transfer?.direction === "send") {
      publishSubjects.add(TRANSFER_UPLOAD_SUBJECT);
    }
  }

  for (const event of uses.eventPublishes) {
    publishSubjects.add(templateToWildcard(event.event.subject));
    for (const capability of event.event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const event of uses.eventSubscribes) {
    subscribeSubjects.add(templateToWildcard(event.event.subject));
    for (const capability of event.event.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }

  return {
    digest: validated.digest,
    contract: validated.contract,
    approval: {
      contractDigest: validated.digest,
      contractId: validated.contract.id,
      displayName: validated.contract.displayName,
      description: validated.contract.description,
      participantKind: validated.contract.kind,
      capabilities: sortUniqueStrings(capabilities),
    },
    publishSubjects: sortUniqueStrings(publishSubjects),
    subscribeSubjects: sortUniqueStrings(subscribeSubjects),
  };
}
