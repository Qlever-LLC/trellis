import type {
  ContractEvent,
  ContractOperation,
  ContractRpcMethod,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import type { ContractApprovalCapability } from "@qlever-llc/trellis/auth";
import {
  resolveContractUsesFromEntries,
  sortUniqueStrings,
  templateToWildcard,
} from "../../catalog/uses.ts";
import { operationControlCapabilityRules } from "../../catalog/permissions.ts";
import type { ContractsModule } from "../../catalog/runtime.ts";
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

function fallbackCapabilityMetadata(key: string): ContractApprovalCapability {
  return {
    displayName: key,
    description: `Requires ${key}.`,
  };
}

function approvalCapabilitiesObject(
  capabilities: Map<string, ContractApprovalCapability>,
): Record<string, ContractApprovalCapability> {
  const result: Record<string, ContractApprovalCapability> = {};
  for (const key of sortUniqueStrings(capabilities.keys())) {
    const metadata = capabilities.get(key);
    if (metadata) result[key] = metadata;
  }
  return result;
}

export async function planUserContractApproval(
  contracts: Pick<ContractsModule, "validateContract" | "getActiveEntries">,
  rawContract: unknown,
): Promise<UserContractApprovalPlan> {
  const validated = await contracts.validateContract(rawContract);
  const uses = resolveContractUsesFromEntries(
    await contracts.getActiveEntries(),
    validated.contract,
  );
  if (
    validated.contract.kind !== "app" && validated.contract.kind !== "agent"
  ) {
    throw new Error(
      `User approval requires an app or agent contract, got ${validated.contract.kind}`,
    );
  }
  const publishSubjects = new Set<string>();
  const subscribeSubjects = new Set<string>();
  const capabilities = new Map<string, ContractApprovalCapability>();
  const addCapability = (key: string, contract: TrellisContractV1) => {
    if (!capabilities.has(key)) {
      capabilities.set(
        key,
        contract.capabilities?.[key] ?? fallbackCapabilityMetadata(key),
      );
    }
  };

  for (
    const event of Object.values<ContractEvent>(validated.contract.events ?? {})
  ) {
    publishSubjects.add(templateToWildcard(event.subject));
    for (const capability of event.capabilities?.publish ?? []) {
      addCapability(capability, validated.contract);
    }
  }

  for (const method of uses.rpcCalls) {
    publishSubjects.add(templateToWildcard(method.method.subject));
    if (method.method.transfer?.direction === "receive") {
      publishSubjects.add(TRANSFER_DOWNLOAD_SUBJECT);
    }
    for (const capability of method.method.capabilities?.call ?? []) {
      addCapability(capability, method.contract);
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
      addCapability(capability, operation.contract);
    }
    for (const requiredCapabilities of operationControlRules) {
      for (const capability of requiredCapabilities) {
        addCapability(capability, operation.contract);
      }
    }
  }

  for (
    const method of Object.values<ContractRpcMethod>(
      validated.contract.rpc ?? {},
    )
  ) {
    if (method.transfer?.direction === "receive") {
      publishSubjects.add(TRANSFER_DOWNLOAD_SUBJECT);
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
      addCapability(capability, event.contract);
    }
  }

  for (const event of uses.eventSubscribes) {
    subscribeSubjects.add(templateToWildcard(event.event.subject));
    for (const capability of event.event.capabilities?.subscribe ?? []) {
      addCapability(capability, event.contract);
    }
  }

  for (const feed of uses.feedSubscribes) {
    publishSubjects.add(templateToWildcard(feed.feed.subject));
    for (const capability of feed.feed.capabilities?.subscribe ?? []) {
      addCapability(capability, feed.contract);
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
      capabilities: approvalCapabilitiesObject(capabilities),
    },
    publishSubjects: sortUniqueStrings(publishSubjects),
    subscribeSubjects: sortUniqueStrings(subscribeSubjects),
  };
}
