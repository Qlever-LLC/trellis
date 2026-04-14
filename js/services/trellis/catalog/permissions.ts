import type { ContractEvent, ContractRpcMethod, ContractSubject } from "@qlever-llc/trellis/contracts";

import {
  type ContractEntry,
  createActiveContractLookup,
  resolveContractUses,
  templateToWildcard,
} from "./uses.ts";
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
  displayName?: string;
};

type RpcInfo = {
  subject: string;
  callCapabilities: string[];
};

type EventInfo = {
  subject: string;
  publishCapabilities: string[];
  subscribeCapabilities: string[];
};

type SubjectInfo = {
  subject: string;
  publishCapabilities: string[];
  subscribeCapabilities: string[];
};

type PermissionState = {
  contracts: ContractEntry[];
  activeById: Map<string, ContractEntry["contract"]>;
};

const JETSTREAM_EVENT_CONTROL_SUBJECTS = [
  "$JS.API.INFO",
  "$JS.API.CONSUMER.CREATE.trellis.>",
  "$JS.API.CONSUMER.DURABLE.CREATE.trellis.>",
  "$JS.API.CONSUMER.INFO.trellis.>",
  "$JS.API.CONSUMER.MSG.NEXT.trellis.>",
  "$JS.ACK.>",
];

const BOOTSTRAP_CONTRACT_IMPLEMENTERS = new Map<string, string>([
  [trellisCoreContract.id, "trellis"],
  [trellisAuthContract.id, "trellis"],
  [trellisStateContract.id, "trellis"],
]);
const AUTH_VALIDATE_SUBJECT = trellisAuthContract.rpc?.["Auth.ValidateRequest"]?.subject;
const TRANSFER_SUBJECT_PREFIXES = ["transfer.v1.upload", "transfer.v1.download"] as const;

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
    requiredCapabilities.every((capability) => grantedCapabilities.includes(capability));
}

function dedupe(subjects: Iterable<string>): string[] {
  return [...new Set(subjects)];
}

function resolvedUses(entry: ContractEntry) {
  return resolveContractUses(entry.contract, (alias, use) => {
    const target = state.activeById.get(use.contract);
    if (!target) {
      throw new Error(`Dependency '${alias}' references inactive contract '${use.contract}'`);
    }
    return target;
  });
}

function implementedContracts(service: ServiceDescriptor): ContractEntry[] {
  return state.contracts.filter((entry) =>
    service.contractDigest === entry.digest ||
    BOOTSTRAP_CONTRACT_IMPLEMENTERS.get(entry.contract.id) === service.displayName
  );
}

function collectAllRpc(): RpcInfo[] {
  return state.contracts.flatMap((entry) =>
    Object.values<ContractRpcMethod>(entry.contract.rpc ?? {}).map((method) => ({
      subject: method.subject,
      callCapabilities: method.capabilities?.call ?? [],
    }))
  );
}

function collectAllEvents(): EventInfo[] {
  return state.contracts.flatMap((entry) =>
    Object.values<ContractEvent>(entry.contract.events ?? {}).map((event) => ({
      subject: event.subject,
      publishCapabilities: event.capabilities?.publish ?? [],
      subscribeCapabilities: event.capabilities?.subscribe ?? [],
    }))
  );
}

function collectAllSubjects(): SubjectInfo[] {
  return state.contracts.flatMap((entry) =>
    Object.values<ContractSubject>(entry.contract.subjects ?? {}).map((subject) => ({
      subject: subject.subject,
      publishCapabilities: subject.capabilities?.publish ?? [],
      subscribeCapabilities: subject.capabilities?.subscribe ?? [],
    }))
  );
}

function ownedPublishRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) => [
    ...Object.values(entry.contract.events ?? {}).map((event) => ({
      subject: templateToWildcard(event.subject),
      requiredCapabilities: event.capabilities?.publish ?? [],
    })),
    ...Object.values(entry.contract.subjects ?? {}).map((subject) => ({
      subject: subject.subject,
      requiredCapabilities: subject.capabilities?.publish ?? [],
    })),
  ]);
}

function ownedSubscribeRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) =>
    Object.values(entry.contract.subjects ?? {}).map((subject) => ({
      subject: subject.subject,
      requiredCapabilities: subject.capabilities?.subscribe ?? [],
    }))
  );
}

function usedPublishRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) => {
    const uses = resolvedUses(entry);
    return [
      ...uses.rpcCalls.map((method) => ({
        subject: templateToWildcard(method.method.subject),
        requiredCapabilities: method.method.capabilities?.call ?? [],
      })),
      ...uses.eventPublishes.map((event) => ({
        subject: templateToWildcard(event.event.subject),
        requiredCapabilities: event.event.capabilities?.publish ?? [],
      })),
      ...uses.subjectPublishes.map((subject) => ({
        subject: subject.subject.subject,
        requiredCapabilities: subject.subject.capabilities?.publish ?? [],
      })),
    ];
  });
}

function usedSubscribeRules(entries: ContractEntry[]): PermissionRule[] {
  return entries.flatMap((entry) => {
    const uses = resolvedUses(entry);
    return [
      ...uses.eventSubscribes.map((event) => ({
        subject: templateToWildcard(event.event.subject),
        requiredCapabilities: event.event.capabilities?.subscribe ?? [],
      })),
      ...uses.subjectSubscribes.map((subject) => ({
        subject: subject.subject.subject,
        requiredCapabilities: subject.subject.capabilities?.subscribe ?? [],
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

function hasDeclaredEventSubscriptions(
  capabilities: string[],
  service: ServiceDescriptor,
): boolean {
  return implementedContracts(service).some((entry) =>
    resolvedUses(entry).eventSubscribes.some((event) =>
      hasRequiredCapabilities(capabilities, event.event.capabilities?.subscribe ?? [])
    )
  );
}

export function setContracts(contracts: ContractEntry[]): void {
  state = createPermissionState(contracts);
}

export function getContracts(): ContractEntry[] {
  return state.contracts;
}

export function getUserPublishSubjects(capabilities: string[]): string[] {
  return dedupe([
    ...TRANSFER_SUBJECT_PREFIXES.map((prefix) => `${prefix}.*.*`),
    ...collectAllRpc()
      .filter((method) => hasRequiredCapabilities(capabilities, method.callCapabilities))
      .map((method) => templateToWildcard(method.subject)),
    ...collectAllEvents()
      .filter((event) => hasRequiredCapabilities(capabilities, event.publishCapabilities))
      .map((event) => templateToWildcard(event.subject)),
    ...collectAllSubjects()
      .filter((subject) => hasRequiredCapabilities(capabilities, subject.publishCapabilities))
      .map((subject) => subject.subject),
  ]);
}

export function getUserSubscribeSubjects(capabilities: string[]): string[] {
  return dedupe([
    ...collectAllEvents()
      .filter((event) => hasRequiredCapabilities(capabilities, event.subscribeCapabilities))
      .map((event) => templateToWildcard(event.subject)),
    ...collectAllSubjects()
      .filter((subject) => hasRequiredCapabilities(capabilities, subject.subscribeCapabilities))
      .map((subject) => subject.subject),
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
      .filter((rule) => hasRequiredCapabilities(capabilities, rule.requiredCapabilities))
      .map((rule) => rule.subject),
    ...(hasRequiredCapabilities(capabilities, ["service"]) && AUTH_VALIDATE_SUBJECT
      ? [templateToWildcard(AUTH_VALIDATE_SUBJECT)]
      : []),
    ...(hasDeclaredEventSubscriptions(capabilities, service) ? JETSTREAM_EVENT_CONTROL_SUBJECTS : []),
  ]);
}

export function getServiceSubscribeSubjects(
  capabilities: string[],
  service: ServiceDescriptor,
): string[] {
  const entries = implementedContracts(service);
  const rules = [...ownedSubscribeRules(entries), ...usedSubscribeRules(entries)];
  const rpcSubjects = hasRequiredCapabilities(capabilities, ["service"])
    ? handledRpcSubjects(service)
    : [];

  return dedupe([
    ...rpcSubjects,
    ...(hasRequiredCapabilities(capabilities, ["service"])
      ? TRANSFER_SUBJECT_PREFIXES.map((prefix) => `${prefix}.${service.sessionKey.slice(0, 16)}.*`)
      : []),
    ...rules
      .filter((rule) => hasRequiredCapabilities(capabilities, rule.requiredCapabilities))
      .map((rule) => rule.subject),
  ]);
}
