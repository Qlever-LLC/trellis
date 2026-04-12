import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import type { ContractStore } from "../../catalog/store.ts";
import {
  resolveContractUsesFromStore,
  templateToWildcard,
} from "../../catalog/uses.ts";
import type { ContractRecord } from "../../state/schemas.ts";

type DeviceProfile = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
  disabled: boolean;
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export type DeviceRuntimeAccess = {
  contractId: string;
  contractDigest: string;
  capabilities: string[];
  publishSubjects: string[];
  subscribeSubjects: string[];
};

type ContractAnalysis = NonNullable<ContractRecord["analysis"]>;
type RpcMethod = ContractAnalysis["rpc"]["methods"][number];
type EventEntry = ContractAnalysis["events"]["events"][number];
type SubjectEntry = NonNullable<ContractAnalysis["subjects"]>["subjects"][number];
type NatsRule = ContractAnalysis["nats"]["publish"][number];

export function resolveDeviceContractDigest(
  profile: DeviceProfile,
  contractDigest: string | undefined,
): string {
  if (typeof contractDigest !== "string" || contractDigest.length === 0) {
    throw new Error("invalid_auth_token");
  }
  if (!profile.allowedDigests.includes(contractDigest)) {
    throw new Error("device_digest_not_allowed");
  }
  return contractDigest;
}

export function deriveDeviceRuntimeAccess(
  profile: DeviceProfile,
  contractRecord: ContractRecord,
  contractStore?: ContractStore,
): DeviceRuntimeAccess {
  if (contractRecord.id !== profile.contractId) {
    throw new Error("device_profile_contract_mismatch");
  }
  if (!profile.allowedDigests.includes(contractRecord.digest)) {
    throw new Error("device_digest_not_allowed");
  }

  const analysis = contractRecord.analysis;
  if (!analysis) {
    throw new Error("device_contract_analysis_missing");
  }
  if (
    analysis.resources.kv.length > 0 ||
    analysis.resources.streams.length > 0 ||
    analysis.resources.jobs.length > 0 ||
    contractRecord.resources !== undefined
  ) {
    throw new Error("device_resources_not_supported");
  }

  const capabilities = uniqueSorted([
    ...analysis.rpc.methods.flatMap((method: RpcMethod) => method.callerCapabilities),
    ...analysis.events.events.flatMap((event: EventEntry) => [
      ...event.publishCapabilities,
      ...event.subscribeCapabilities,
    ]),
    ...(analysis.subjects?.subjects ?? []).flatMap((subject: SubjectEntry) => [
      ...subject.publishCapabilities,
      ...subject.subscribeCapabilities,
    ]),
    ...analysis.nats.publish.flatMap((rule: NatsRule) => rule.requiredCapabilities),
    ...analysis.nats.subscribe.flatMap((rule: NatsRule) => rule.requiredCapabilities),
  ]);

  const publishSubjects = new Set<string>(
    analysis.nats.publish.map((rule: NatsRule) =>
      rule.wildcardSubject || rule.subject
    ),
  );
  const subscribeSubjects = new Set<string>(
    analysis.nats.subscribe.map((rule: NatsRule) =>
      rule.wildcardSubject || rule.subject
    ),
  );

  if (contractStore) {
    const contract = JSON.parse(contractRecord.contract) as TrellisContractV1;
    const uses = resolveContractUsesFromStore(contractStore, contract);

    for (const method of uses.rpcCalls) {
      publishSubjects.add(templateToWildcard(method.method.subject));
      for (const capability of method.method.capabilities?.call ?? []) {
        capabilities.push(capability);
      }
    }

    for (const event of uses.eventPublishes) {
      publishSubjects.add(templateToWildcard(event.event.subject));
      for (const capability of event.event.capabilities?.publish ?? []) {
        capabilities.push(capability);
      }
    }

    for (const event of uses.eventSubscribes) {
      subscribeSubjects.add(templateToWildcard(event.event.subject));
      for (const capability of event.event.capabilities?.subscribe ?? []) {
        capabilities.push(capability);
      }
    }

    for (const subject of uses.subjectPublishes) {
      publishSubjects.add(subject.subject.subject);
      for (const capability of subject.subject.capabilities?.publish ?? []) {
        capabilities.push(capability);
      }
    }

    for (const subject of uses.subjectSubscribes) {
      subscribeSubjects.add(subject.subject.subject);
      for (const capability of subject.subject.capabilities?.subscribe ?? []) {
        capabilities.push(capability);
      }
    }
  }

  return {
    contractId: contractRecord.id,
    contractDigest: contractRecord.digest,
    capabilities: uniqueSorted(capabilities),
    publishSubjects: uniqueSorted(publishSubjects),
    subscribeSubjects: uniqueSorted(subscribeSubjects),
  };
}
