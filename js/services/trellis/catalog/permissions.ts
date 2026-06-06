import type {
  ContractOperation,
  ContractRpcMethod,
} from "@qlever-llc/trellis/contracts";

import {
  type ContractEntry,
  createKnownContractLookup,
  resolveContractUses,
  templateToWildcard,
} from "./uses.ts";
import { getKvPermissionGrants } from "./resources.ts";
import { CONTRACT_DIGEST as TRELLIS_JOBS_CONTRACT_DIGEST } from "#trellis-generated-sdk/jobs";
import { CONTRACT as trellisAuthContract } from "../contracts/trellis_auth.ts";
import type { DeploymentAuthoritySurface } from "../auth/schemas.ts";

type AuthorityNeedSet = {
  surfaces: DeploymentAuthoritySurface[];
};

type PermissionRule = {
  subject: string;
  requiredCapabilities: string[];
  surface?: DeploymentAuthoritySurface;
};

type ServiceDescriptor = {
  sessionKey: string;
  contractDigest?: string;
  authorityNeeds?: AuthorityNeedSet;
};

type CallerContractDescriptor = {
  contractDigest: string;
  identityAuthority?: AuthorityNeedSet;
};

type PermissionState = {
  contracts: ContractEntry[];
  knownById: Map<string, ContractEntry["contract"]>;
};

const AUTH_VALIDATE_SUBJECT = trellisAuthContract.rpc
  ?.["Auth.Requests.Validate"]
  ?.subject;
export const TRANSFER_UPLOAD_SUBJECT_PREFIX = "transfer.v1.upload";
export const TRANSFER_DOWNLOAD_SUBJECT_PREFIX = "transfer.v1.download";
export const TRELLIS_JOBS_CONTRACT_ID = "trellis.jobs@v1";
const JOBS_STREAM = "JOBS";
const JOBS_WORK_STREAM = "JOBS_WORK";
const JOBS_ADVISORIES_STREAM = "JOBS_ADVISORIES";
const JOBS_WORKER_PRESENCE_BUCKET = "JOBS_WORKER_PRESENCE";

function operationStoreBucket(sessionKey: string): string {
  return `trellis_operations_${sessionKey.slice(0, 16)}`;
}

function createPermissionState(contracts: ContractEntry[]): PermissionState {
  return {
    contracts,
    knownById: createKnownContractLookup(contracts),
  };
}

export function hasRequiredCapabilities(
  grantedCapabilities: string[],
  requiredCapabilities: string[],
): boolean {
  return requiredCapabilities.length === 0 ||
    requiredCapabilities.every((capability) =>
      grantedCapabilities.includes(capability)
    );
}

function dedupe(subjects: Iterable<string>): string[] {
  return [...new Set(subjects)];
}

function authorityHasSurface(
  authority: AuthorityNeedSet | undefined,
  surface: DeploymentAuthoritySurface | undefined,
): boolean {
  if (!authority || !surface) return true;
  return authority.surfaces.some((allowed) =>
    allowed.contractId === surface.contractId &&
    allowed.kind === surface.kind &&
    allowed.name === surface.name &&
    allowed.action === surface.action
  );
}

function permittedRuleSubjects(
  rules: PermissionRule[],
  capabilities: string[],
  authority: AuthorityNeedSet | undefined,
): string[] {
  return rules
    .filter((rule) =>
      authorityHasSurface(authority, rule.surface) &&
      hasRequiredCapabilities(capabilities, rule.requiredCapabilities)
    )
    .map((rule) => rule.subject);
}

/**
 * Derive the operation control capabilities for get, wait, and watch.
 */
export function operationObserveCapabilities(
  operation: ContractOperation,
): string[] {
  return operation.capabilities?.observe ?? operation.capabilities?.call ?? [];
}

/**
 * Derive the operation cancel capabilities when cancel is declared and enabled.
 */
export function operationCancelCapabilities(
  operation: ContractOperation,
): string[] | undefined {
  if (!operation.cancel || operation.capabilities?.cancel === undefined) {
    return undefined;
  }
  return operation.capabilities.cancel;
}

/**
 * Derive the capability alternatives that grant operation control publishing.
 */
export function operationControlCapabilityRules(
  operation: ContractOperation,
): string[][] {
  const cancelCapabilities = operationCancelCapabilities(operation);
  return [
    operationObserveCapabilities(operation),
    ...(cancelCapabilities !== undefined ? [cancelCapabilities] : []),
  ];
}

function resolvedUses(entry: ContractEntry, permissionState: PermissionState) {
  return resolveContractUses(entry.contract, (alias, use, options) => {
    const target = permissionState.knownById.get(use.contract);
    if (!target) {
      if (!options.required) {
        return null;
      }
      throw new Error(
        `Dependency '${alias}' references unknown contract '${use.contract}'`,
      );
    }
    return target;
  });
}

function implementedContracts(
  service: ServiceDescriptor,
  permissionState: PermissionState,
): ContractEntry[] {
  return permissionState.contracts.filter((entry) =>
    service.contractDigest === entry.digest
  );
}

function callerContracts(
  caller: CallerContractDescriptor,
  permissionState: PermissionState,
): ContractEntry[] {
  return permissionState.contracts.filter((entry) =>
    caller.contractDigest === entry.digest
  );
}

function ownedPublishRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) => [
    ...Object.entries(entry.contract.events ?? {}).map(([name, event]) => ({
      subject: templateToWildcard(event.subject),
      requiredCapabilities: [],
      surface: {
        contractId: entry.contract.id,
        kind: "event" as const,
        name,
        action: "publish" as const,
      },
    })),
  ]);
}

function ownedSubscribeRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) =>
    Object.entries(entry.contract.events ?? {}).map(([name, event]) => ({
      subject: templateToWildcard(event.subject),
      requiredCapabilities: event.capabilities?.subscribe ?? [],
      surface: {
        contractId: entry.contract.id,
        kind: "event" as const,
        name,
        action: "subscribe" as const,
      },
    }))
  );
}

function usedPublishRules(
  entries: ContractEntry[],
  permissionState: PermissionState,
): PermissionRule[] {
  return entries.flatMap((entry) => {
    const uses = resolvedUses(entry, permissionState);
    return [
      ...uses.rpcCalls.map((method) => ({
        subject: templateToWildcard(method.method.subject),
        requiredCapabilities: method.method.capabilities?.call ?? [],
        surface: {
          contractId: method.contractId,
          kind: "rpc" as const,
          name: method.key,
          action: "call" as const,
        },
      })),
      ...uses.operationCalls.flatMap((operation) => {
        const controlSubject = templateToWildcard(
          `${operation.operation.subject}.control`,
        );
        return [
          {
            subject: templateToWildcard(operation.operation.subject),
            requiredCapabilities: operation.operation.capabilities?.call ?? [],
            surface: {
              contractId: operation.contractId,
              kind: "operation" as const,
              name: operation.key,
              action: "call" as const,
            },
          },
          {
            subject: controlSubject,
            requiredCapabilities: operationObserveCapabilities(
              operation.operation,
            ),
            surface: {
              contractId: operation.contractId,
              kind: "operation" as const,
              name: operation.key,
              action: "observe" as const,
            },
          },
          ...(operationCancelCapabilities(operation.operation) !== undefined
            ? [{
              subject: controlSubject,
              requiredCapabilities: operationCancelCapabilities(
                operation.operation,
              ) ?? [],
              surface: {
                contractId: operation.contractId,
                kind: "operation" as const,
                name: operation.key,
                action: "cancel" as const,
              },
            }]
            : []),
        ];
      }),
      ...uses.operationCalls
        .filter((operation) =>
          operation.operation.transfer?.direction === "send"
        )
        .map((operation) => ({
          subject: `${TRANSFER_UPLOAD_SUBJECT_PREFIX}.*.*`,
          requiredCapabilities: operation.operation.capabilities?.call ?? [],
          surface: {
            contractId: operation.contractId,
            kind: "operation" as const,
            name: operation.key,
            action: "call" as const,
          },
        })),
      ...uses.rpcCalls
        .filter((method) => method.method.transfer?.direction === "receive")
        .map((method) => ({
          subject: `${TRANSFER_DOWNLOAD_SUBJECT_PREFIX}.*.*`,
          requiredCapabilities: method.method.capabilities?.call ?? [],
          surface: {
            contractId: method.contractId,
            kind: "rpc" as const,
            name: method.key,
            action: "call" as const,
          },
        })),
      ...uses.eventPublishes.map((event) => ({
        subject: templateToWildcard(event.event.subject),
        requiredCapabilities: event.event.capabilities?.publish ?? [],
        surface: {
          contractId: event.contractId,
          kind: "event" as const,
          name: event.key,
          action: "publish" as const,
        },
      })),
      ...uses.feedSubscribes.map((feed) => ({
        subject: templateToWildcard(feed.feed.subject),
        requiredCapabilities: feed.feed.capabilities?.subscribe ?? [],
        surface: {
          contractId: feed.contractId,
          kind: "feed" as const,
          name: feed.key,
          action: "subscribe" as const,
        },
      })),
    ];
  });
}

function usedSubscribeRules(
  entries: ContractEntry[],
  permissionState: PermissionState,
): PermissionRule[] {
  return entries.flatMap((entry) => {
    const uses = resolvedUses(entry, permissionState);
    return [
      ...uses.eventSubscribes.map((event) => ({
        subject: templateToWildcard(event.event.subject),
        requiredCapabilities: event.event.capabilities?.subscribe ?? [],
        surface: {
          contractId: event.contractId,
          kind: "event" as const,
          name: event.key,
          action: "subscribe" as const,
        },
      })),
    ];
  });
}

function handledRpcRules(
  service: ServiceDescriptor,
  permissionState: PermissionState,
): PermissionRule[] {
  return implementedContracts(service, permissionState).flatMap((entry) =>
    Object.entries<ContractRpcMethod>(entry.contract.rpc ?? {}).map(([
      name,
      method,
    ]) => ({
      subject: templateToWildcard(method.subject),
      requiredCapabilities: [],
      surface: {
        contractId: entry.contract.id,
        kind: "rpc" as const,
        name,
        action: "call" as const,
      },
    }))
  );
}

function handledOperationRules(
  service: ServiceDescriptor,
  permissionState: PermissionState,
): PermissionRule[] {
  return implementedContracts(service, permissionState).flatMap((entry) =>
    Object.entries<ContractOperation>(entry.contract.operations ?? {}).flatMap((
      [name, operation],
    ) => {
      const controlSubject = templateToWildcard(`${operation.subject}.control`);
      return [
        {
          subject: templateToWildcard(operation.subject),
          requiredCapabilities: [],
          surface: {
            contractId: entry.contract.id,
            kind: "operation" as const,
            name,
            action: "call" as const,
          },
        },
        {
          subject: controlSubject,
          requiredCapabilities: [],
          surface: {
            contractId: entry.contract.id,
            kind: "operation" as const,
            name,
            action: "observe" as const,
          },
        },
        ...(operation.cancel
          ? [{
            subject: controlSubject,
            requiredCapabilities: [],
            surface: {
              contractId: entry.contract.id,
              kind: "operation" as const,
              name,
              action: "cancel" as const,
            },
          }]
          : []),
      ];
    })
  );
}

function handledFeedRules(
  service: ServiceDescriptor,
  permissionState: PermissionState,
): PermissionRule[] {
  return implementedContracts(service, permissionState).flatMap((entry) =>
    Object.entries(
      (entry.contract as { feeds?: Record<string, { subject: string }> })
        .feeds ??
        {},
    ).map(([name, feed]) => ({
      subject: templateToWildcard(feed.subject),
      requiredCapabilities: [],
      surface: {
        contractId: entry.contract.id,
        kind: "feed" as const,
        name,
        action: "subscribe" as const,
      },
    }))
  );
}

function handledTransferRules(
  service: ServiceDescriptor,
  permissionState: PermissionState,
): PermissionRule[] {
  const sessionPrefix = service.sessionKey.slice(0, 16);
  return implementedContracts(service, permissionState).flatMap((entry) => [
    ...Object.entries<ContractOperation>(entry.contract.operations ?? {})
      .filter(([, operation]) => operation.transfer?.direction === "send")
      .map(([name]) => ({
        subject: `${TRANSFER_UPLOAD_SUBJECT_PREFIX}.${sessionPrefix}.*`,
        requiredCapabilities: [],
        surface: {
          contractId: entry.contract.id,
          kind: "operation" as const,
          name,
          action: "call" as const,
        },
      })),
    ...Object.entries<ContractRpcMethod>(entry.contract.rpc ?? {})
      .filter(([, method]) => method.transfer?.direction === "receive")
      .map(([name]) => ({
        subject: `${TRANSFER_DOWNLOAD_SUBJECT_PREFIX}.${sessionPrefix}.*`,
        requiredCapabilities: [],
        surface: {
          contractId: entry.contract.id,
          kind: "rpc" as const,
          name,
          action: "call" as const,
        },
      })),
  ]);
}

function implementsJobsAdminService(
  service: ServiceDescriptor,
  permissionState: PermissionState,
): boolean {
  return implementedContracts(service, permissionState).some((entry) =>
    entry.contract.id === TRELLIS_JOBS_CONTRACT_ID &&
    entry.digest === TRELLIS_JOBS_CONTRACT_DIGEST
  );
}

export function jobsAdminRuntimePublishSubjects(): string[] {
  return [
    "trellis.jobs.>",
    "$JS.API.INFO",
    ...[JOBS_STREAM, JOBS_ADVISORIES_STREAM].flatMap((stream) => [
      `$JS.API.STREAM.INFO.${stream}`,
      `$JS.API.CONSUMER.CREATE.${stream}.>`,
      `$JS.API.CONSUMER.DURABLE.CREATE.${stream}.>`,
      `$JS.API.CONSUMER.INFO.${stream}.>`,
      `$JS.API.CONSUMER.MSG.NEXT.${stream}.>`,
      `$JS.ACK.${stream}.>`,
    ]),
    `$JS.API.STREAM.INFO.${JOBS_WORK_STREAM}`,
    `$JS.API.STREAM.MSG.GET.${JOBS_WORK_STREAM}`,
    ...getKvPermissionGrants(JOBS_WORKER_PRESENCE_BUCKET, {
      allowCreate: true,
    }).publish,
  ];
}

/**
 * Derive publish subjects for a user/app session against an explicit contract set.
 * This is used when the caller app contract is known but is not part of the
 * service/device active catalog used for runtime-owned subjects.
 */
export function getUserPublishSubjectsForContracts(
  capabilities: string[],
  caller: CallerContractDescriptor,
  contracts: ContractEntry[],
): string[] {
  const permissionState = createPermissionState(contracts);
  const entries = callerContracts(caller, permissionState);
  const rules = usedPublishRules(entries, permissionState);

  return dedupe([
    ...permittedRuleSubjects(rules, capabilities, caller.identityAuthority),
  ]);
}

/**
 * Derive subscribe subjects for a user/app session against an explicit contract set.
 */
export function getUserSubscribeSubjectsForContracts(
  capabilities: string[],
  caller: CallerContractDescriptor,
  contracts: ContractEntry[],
): string[] {
  const permissionState = createPermissionState(contracts);
  const entries = callerContracts(caller, permissionState);
  const rules = usedSubscribeRules(entries, permissionState);

  return dedupe([
    ...permittedRuleSubjects(rules, capabilities, caller.identityAuthority),
  ]);
}

/**
 * Derive publish subjects for a service session against an explicit contract set.
 */
export function getServicePublishSubjectsForContracts(
  capabilities: string[],
  service: ServiceDescriptor,
  contracts: ContractEntry[],
): string[] {
  const permissionState = createPermissionState(contracts);
  const entries = implementedContracts(service, permissionState);
  const rules = [
    ...ownedPublishRules(entries),
    ...usedPublishRules(entries, permissionState),
  ];

  return dedupe([
    ...permittedRuleSubjects(rules, capabilities, service.authorityNeeds),
    ...(hasRequiredCapabilities(capabilities, ["service"])
      ? getKvPermissionGrants(operationStoreBucket(service.sessionKey), {
        allowCreate: true,
      }).publish
      : []),
    ...(hasRequiredCapabilities(capabilities, ["service"]) &&
        AUTH_VALIDATE_SUBJECT
      ? [templateToWildcard(AUTH_VALIDATE_SUBJECT)]
      : []),
    ...(hasRequiredCapabilities(capabilities, ["service"]) &&
        implementsJobsAdminService(service, permissionState)
      ? jobsAdminRuntimePublishSubjects()
      : []),
  ]);
}

/**
 * Derive subscribe subjects for a service session against an explicit contract set.
 */
export function getServiceSubscribeSubjectsForContracts(
  capabilities: string[],
  service: ServiceDescriptor,
  contracts: ContractEntry[],
): string[] {
  const permissionState = createPermissionState(contracts);
  const entries = implementedContracts(service, permissionState);
  const rules = [
    ...ownedSubscribeRules(entries),
    ...usedSubscribeRules(entries, permissionState),
  ];
  const rpcSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? permittedRuleSubjects(
      handledRpcRules(service, permissionState),
      [],
      service.authorityNeeds,
    )
    : [];
  const operationSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? permittedRuleSubjects(
      handledOperationRules(service, permissionState),
      [],
      service.authorityNeeds,
    )
    : [];
  const feedSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? permittedRuleSubjects(
      handledFeedRules(service, permissionState),
      [],
      service.authorityNeeds,
    )
    : [];
  const transferSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? permittedRuleSubjects(
      handledTransferRules(service, permissionState),
      [],
      service.authorityNeeds,
    )
    : [];

  return dedupe([
    ...rpcSubjects,
    ...operationSubjects,
    ...feedSubjects,
    ...transferSubjects,
    ...permittedRuleSubjects(rules, capabilities, service.authorityNeeds),
  ]);
}
