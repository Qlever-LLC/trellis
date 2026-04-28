import type {
  ContractOperation,
  ContractRpcMethod,
} from "@qlever-llc/trellis/contracts";

import {
  type ContractEntry,
  createActiveContractLookup,
  resolveContractUses,
  templateToWildcard,
} from "./uses.ts";
import { getKvPermissionGrants } from "./resources.ts";
import { CONTRACT as trellisAuthContract } from "../contracts/trellis_auth.ts";
import { CONTRACT as trellisCoreContract } from "../contracts/trellis_core.ts";
import { CONTRACT as trellisStateContract } from "../contracts/trellis_state.ts";

type PermissionRule = {
  subject: string;
  requiredCapabilities: string[];
};

type ServiceDescriptor = {
  sessionKey: string;
  contractDigest?: string;
};

type CallerContractDescriptor = {
  contractDigest: string;
};

type PermissionState = {
  contracts: ContractEntry[];
  activeById: Map<string, ContractEntry["contract"]>;
};

const JETSTREAM_EVENT_CONTROL_SUBJECTS = [
  "$JS.API.INFO",
  "$JS.API.CONSUMER.DURABLE.CREATE.trellis.>",
  "$JS.API.CONSUMER.INFO.trellis.>",
  "$JS.API.CONSUMER.MSG.NEXT.trellis.>",
  "$JS.ACK.>",
];

const AUTH_VALIDATE_SUBJECT = trellisAuthContract.rpc?.["Auth.ValidateRequest"]
  ?.subject;
const TRANSFER_UPLOAD_SUBJECT_PREFIX = "transfer.v1.upload";
const TRANSFER_DOWNLOAD_SUBJECT_PREFIX = "transfer.v1.download";

function operationStoreBucket(sessionKey: string): string {
  return `trellis_operations_${sessionKey.slice(0, 16)}`;
}

function createPermissionState(contracts: ContractEntry[]): PermissionState {
  return {
    contracts,
    activeById: createActiveContractLookup(contracts),
  };
}

let state = createPermissionState([
  { digest: trellisCoreContract.id, contract: trellisCoreContract },
  { digest: trellisAuthContract.id, contract: trellisAuthContract },
  { digest: trellisStateContract.id, contract: trellisStateContract },
]);

function hasRequiredCapabilities(
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

function operationControlCapabilityRules(
  operation: ContractOperation,
): string[][] {
  return [
    operation.capabilities?.read ?? operation.capabilities?.call ?? [],
    ...(operation.cancel && operation.capabilities?.cancel !== undefined
      ? [operation.capabilities.cancel]
      : []),
  ];
}

function resolvedUses(entry: ContractEntry) {
  return resolveContractUses(entry.contract, (alias, use) => {
    const target = state.activeById.get(use.contract);
    if (!target) {
      throw new Error(
        `Dependency '${alias}' references inactive contract '${use.contract}'`,
      );
    }
    return target;
  });
}

function implementedContracts(service: ServiceDescriptor): ContractEntry[] {
  return state.contracts.filter((entry) =>
    service.contractDigest === entry.digest
  );
}

function callerContracts(caller: CallerContractDescriptor): ContractEntry[] {
  return state.contracts.filter((entry) =>
    caller.contractDigest === entry.digest
  );
}

function ownedPublishRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) => [
    ...Object.values(entry.contract.events ?? {}).map((event) => ({
      subject: templateToWildcard(event.subject),
      requiredCapabilities: event.capabilities?.publish ?? [],
    })),
  ]);
}

function ownedSubscribeRules(_entries: ContractEntry[]): PermissionRule[] {
  return [];
}

function usedPublishRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) => {
    const uses = resolvedUses(entry);
    return [
      ...uses.rpcCalls.map((method) => ({
        subject: templateToWildcard(method.method.subject),
        requiredCapabilities: method.method.capabilities?.call ?? [],
      })),
      ...uses.operationCalls.flatMap((operation) => {
        const controlSubject = templateToWildcard(
          `${operation.operation.subject}.control`,
        );
        return [
          {
            subject: templateToWildcard(operation.operation.subject),
            requiredCapabilities: operation.operation.capabilities?.call ?? [],
          },
          ...operationControlCapabilityRules(operation.operation).map(
            (requiredCapabilities) => ({
              subject: controlSubject,
              requiredCapabilities,
            }),
          ),
        ];
      }),
      ...uses.operationCalls
        .filter((operation) =>
          operation.operation.transfer?.direction === "send"
        )
        .map((operation) => ({
          subject: `${TRANSFER_UPLOAD_SUBJECT_PREFIX}.*.*`,
          requiredCapabilities: operation.operation.capabilities?.call ?? [],
        })),
      ...uses.eventPublishes.map((event) => ({
        subject: templateToWildcard(event.event.subject),
        requiredCapabilities: event.event.capabilities?.publish ?? [],
      })),
    ];
  });
}

function usedSubscribeRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) => {
    const uses = resolvedUses(entry);
    return [
      ...uses.rpcCalls
        .filter((method) => method.method.transfer?.direction === "receive")
        .map((method) => ({
          subject: `${TRANSFER_DOWNLOAD_SUBJECT_PREFIX}.*.*`,
          requiredCapabilities: method.method.capabilities?.call ?? [],
        })),
      ...uses.eventSubscribes.map((event) => ({
        subject: templateToWildcard(event.event.subject),
        requiredCapabilities: event.event.capabilities?.subscribe ?? [],
      })),
    ];
  });
}

function handledRpcSubjects(service: ServiceDescriptor): string[] {
  return implementedContracts(service).flatMap((entry) =>
    Object.values<ContractRpcMethod>(entry.contract.rpc ?? {}).map((method) =>
      templateToWildcard(method.subject)
    )
  );
}

function handledOperationSubjects(service: ServiceDescriptor): string[] {
  return implementedContracts(service).flatMap((entry) =>
    Object.values<ContractOperation>(entry.contract.operations ?? {}).flatMap((
      operation,
    ) => [
      templateToWildcard(operation.subject),
      templateToWildcard(`${operation.subject}.control`),
    ])
  );
}

function handledTransferSubjects(service: ServiceDescriptor): string[] {
  const sessionPrefix = service.sessionKey.slice(0, 16);
  return implementedContracts(service).flatMap((entry) => [
    ...Object.values<ContractOperation>(entry.contract.operations ?? {})
      .filter((operation) => operation.transfer?.direction === "send")
      .map(() => `${TRANSFER_UPLOAD_SUBJECT_PREFIX}.${sessionPrefix}.*`),
    ...Object.values<ContractRpcMethod>(entry.contract.rpc ?? {})
      .filter((method) => method.transfer?.direction === "receive")
      .map(() => `${TRANSFER_DOWNLOAD_SUBJECT_PREFIX}.${sessionPrefix}.*`),
  ]);
}

function hasDeclaredEventSubscriptions(
  capabilities: string[],
  service: ServiceDescriptor,
): boolean {
  return implementedContracts(service).some((entry) =>
    resolvedUses(entry).eventSubscribes.some((event) =>
      hasRequiredCapabilities(
        capabilities,
        event.event.capabilities?.subscribe ?? [],
      )
    )
  );
}

export function setContracts(contracts: ContractEntry[]): void {
  state = createPermissionState(contracts);
}

export function getContracts(): ContractEntry[] {
  return state.contracts;
}

/**
 * Derive publish subjects for a user/app session from the approved caller digest.
 */
export function getUserPublishSubjects(
  capabilities: string[],
  caller: CallerContractDescriptor,
): string[] {
  const entries = callerContracts(caller);
  const rules = usedPublishRules(entries);

  return dedupe([
    ...rules
      .filter((rule) =>
        hasRequiredCapabilities(capabilities, rule.requiredCapabilities)
      )
      .map((rule) => rule.subject),
  ]);
}

/**
 * Derive subscribe subjects for a user/app session from the approved caller digest.
 */
export function getUserSubscribeSubjects(
  capabilities: string[],
  caller: CallerContractDescriptor,
): string[] {
  const entries = callerContracts(caller);
  const rules = usedSubscribeRules(entries);

  return dedupe([
    ...rules
      .filter((rule) =>
        hasRequiredCapabilities(capabilities, rule.requiredCapabilities)
      )
      .map((rule) => rule.subject),
  ]);
}

export function getServicePublishSubjects(
  capabilities: string[],
  service: ServiceDescriptor,
): string[] {
  const entries = implementedContracts(service);
  const rules = [...ownedPublishRules(entries), ...usedPublishRules(entries)];

  return dedupe([
    ...rules
      .filter((rule) =>
        hasRequiredCapabilities(capabilities, rule.requiredCapabilities)
      )
      .map((rule) => rule.subject),
    ...(hasRequiredCapabilities(capabilities, ["service"])
      ? getKvPermissionGrants(operationStoreBucket(service.sessionKey), {
        allowCreate: true,
      }).publish
      : []),
    ...(hasRequiredCapabilities(capabilities, ["service"]) &&
        AUTH_VALIDATE_SUBJECT
      ? [templateToWildcard(AUTH_VALIDATE_SUBJECT)]
      : []),
    ...(hasDeclaredEventSubscriptions(capabilities, service)
      ? JETSTREAM_EVENT_CONTROL_SUBJECTS
      : []),
  ]);
}

export function getServiceSubscribeSubjects(
  capabilities: string[],
  service: ServiceDescriptor,
): string[] {
  const entries = implementedContracts(service);
  const rules = [
    ...ownedSubscribeRules(entries),
    ...usedSubscribeRules(entries),
  ];
  const rpcSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? handledRpcSubjects(service)
    : [];
  const operationSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? handledOperationSubjects(service)
    : [];
  const transferSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? handledTransferSubjects(service)
    : [];

  return dedupe([
    ...rpcSubjects,
    ...operationSubjects,
    ...transferSubjects,
    ...rules
      .filter((rule) =>
        hasRequiredCapabilities(capabilities, rule.requiredCapabilities)
      )
      .map((rule) => rule.subject),
  ]);
}
