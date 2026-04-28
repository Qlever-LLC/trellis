import type {
  ContractOperation,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import type { ContractStore } from "../../catalog/store.ts";
import {
  hasRequiredCapabilities,
  operationControlCapabilityRules,
} from "../../catalog/permissions.ts";
import {
  resolveContractUsesFromStore,
  templateToWildcard,
} from "../../catalog/uses.ts";
import type { ContractRecord } from "../../catalog/schemas.ts";

type DeviceDeployment = {
  deploymentId: string;
  appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
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

export type DeviceRuntimeAccessDenialReason =
  | "invalid_auth_token"
  | "device_digest_not_allowed"
  | "device_deployment_contract_mismatch"
  | "device_contract_analysis_missing"
  | "device_resources_not_supported";

export type DeviceRuntimeAccessResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: DeviceRuntimeAccessDenialReason };

type ContractAnalysis = NonNullable<ContractRecord["analysis"]>;
type RpcMethod = ContractAnalysis["rpc"]["methods"][number];
type EventEntry = ContractAnalysis["events"]["events"][number];
type NatsRule = ContractAnalysis["nats"]["publish"][number];
const TRANSFER_UPLOAD_SUBJECT = "transfer.v1.upload.*.*";
const TRANSFER_DOWNLOAD_SUBJECT = "transfer.v1.download.*.*";

function accessOk<T>(value: T): DeviceRuntimeAccessResult<T> {
  return { ok: true, value };
}

function accessDeny<T>(
  reason: DeviceRuntimeAccessDenialReason,
): DeviceRuntimeAccessResult<T> {
  return { ok: false, reason };
}

function hasOperationControlCapability(
  capabilities: string[],
  operation: ContractOperation,
): boolean {
  return operationControlCapabilityRules(operation).some((required) =>
    hasRequiredCapabilities(capabilities, required)
  );
}

export function resolveDeviceContractDigest(
  deployment: DeviceDeployment,
  contractDigest: string | undefined,
): DeviceRuntimeAccessResult<string> {
  if (typeof contractDigest !== "string" || contractDigest.length === 0) {
    return accessDeny("invalid_auth_token");
  }
  if (
    !deployment.appliedContracts.some((entry) =>
      entry.allowedDigests.includes(contractDigest)
    )
  ) {
    return accessDeny("device_digest_not_allowed");
  }
  return accessOk(contractDigest);
}

export function deriveDeviceRuntimeAccess(
  deployment: DeviceDeployment,
  contractRecord: ContractRecord,
  contractStore?: ContractStore,
): DeviceRuntimeAccessResult<DeviceRuntimeAccess> {
  const applied = deployment.appliedContracts.find((entry) =>
    entry.allowedDigests.includes(contractRecord.digest)
  );
  if (!applied || contractRecord.id !== applied.contractId) {
    return accessDeny("device_deployment_contract_mismatch");
  }

  const analysis = contractRecord.analysis;
  if (!analysis) {
    return accessDeny("device_contract_analysis_missing");
  }
  if (
    analysis.resources.kv.length > 0 ||
    analysis.resources.jobs.length > 0 ||
    contractRecord.resources !== undefined
  ) {
    return accessDeny("device_resources_not_supported");
  }

  const capabilities = uniqueSorted([
    ...analysis.rpc.methods.flatMap((method: RpcMethod) =>
      method.callerCapabilities
    ),
    ...analysis.events.events.flatMap((event: EventEntry) => [
      ...event.publishCapabilities,
      ...event.subscribeCapabilities,
    ]),
    ...analysis.nats.publish.flatMap((rule: NatsRule) =>
      rule.requiredCapabilities
    ),
    ...analysis.nats.subscribe.flatMap((rule: NatsRule) =>
      rule.requiredCapabilities
    ),
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

    for (const operation of uses.operationCalls) {
      publishSubjects.add(templateToWildcard(operation.operation.subject));
      if (operation.operation.transfer?.direction === "send") {
        publishSubjects.add(TRANSFER_UPLOAD_SUBJECT);
      }
      for (const capability of operation.operation.capabilities?.call ?? []) {
        capabilities.push(capability);
      }
      if (hasOperationControlCapability(capabilities, operation.operation)) {
        publishSubjects.add(
          templateToWildcard(`${operation.operation.subject}.control`),
        );
      }
    }

    for (const method of uses.rpcCalls) {
      if (method.method.transfer?.direction === "receive") {
        subscribeSubjects.add(TRANSFER_DOWNLOAD_SUBJECT);
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
  }

  return accessOk({
    contractId: contractRecord.id,
    contractDigest: contractRecord.digest,
    capabilities: uniqueSorted(capabilities),
    publishSubjects: uniqueSorted(publishSubjects),
    subscribeSubjects: uniqueSorted(subscribeSubjects),
  });
}
