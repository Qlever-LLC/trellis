import type { ContractEvent, ContractSubject, TrellisContractV1 } from "@qlever-llc/trellis-contracts";
import {
  resolveContractUsesFromStore,
  sortUniqueStrings,
  templateToWildcard,
} from "../../catalog/uses.ts";
import type { ContractStore } from "../../catalog/store.ts";
import type { ContractApproval } from "../../state/schemas.ts";

export type UserContractApprovalPlan = {
  digest: string;
  contract: TrellisContractV1;
  approval: ContractApproval;
  publishSubjects: string[];
  subscribeSubjects: string[];
};

export async function planUserContractApproval(
  contractStore: ContractStore,
  rawContract: unknown,
): Promise<UserContractApprovalPlan> {
  const validated = await contractStore.validate(rawContract);
  const uses = resolveContractUsesFromStore(contractStore, validated.contract);
  const publishSubjects = new Set<string>();
  const subscribeSubjects = new Set<string>();
  const capabilities = new Set<string>();

  for (const event of Object.values<ContractEvent>(validated.contract.events ?? {})) {
    publishSubjects.add(templateToWildcard(event.subject));
    for (const capability of event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const subject of Object.values<ContractSubject>(validated.contract.subjects ?? {})) {
    publishSubjects.add(subject.subject);
    subscribeSubjects.add(subject.subject);
    for (const capability of subject.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
    for (const capability of subject.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }

  for (const method of uses.rpcCalls) {
    publishSubjects.add(templateToWildcard(method.method.subject));
    for (const capability of method.method.capabilities?.call ?? []) {
      capabilities.add(capability);
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

  for (const subject of uses.subjectPublishes) {
    publishSubjects.add(subject.subject.subject);
    for (const capability of subject.subject.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const subject of uses.subjectSubscribes) {
    subscribeSubjects.add(subject.subject.subject);
    for (const capability of subject.subject.capabilities?.subscribe ?? []) {
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
      kind: validated.contract.kind,
      capabilities: sortUniqueStrings(capabilities),
    },
    publishSubjects: sortUniqueStrings(publishSubjects),
    subscribeSubjects: sortUniqueStrings(subscribeSubjects),
  };
}
