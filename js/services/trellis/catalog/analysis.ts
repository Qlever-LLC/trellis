import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import {
  getContractResourceAnalysis,
  getContractResourceSummary,
} from "./resources.ts";

function templateToWildcard(subject: string): string {
  return subject.replace(/\{[^}]+\}/g, "*");
}

function subjectNamespace(subject: string): string | null {
  const parts = subject.split(".");
  if (parts.length < 3) return null;
  if (
    parts[0] !== "rpc" && parts[0] !== "events" && parts[0] !== "operations"
  ) {
    return null;
  }
  if (!parts[1]?.startsWith("v")) return null;
  return parts[2] ?? null;
}

function operationReadCapabilities(operation: {
  capabilities?: { call?: string[]; read?: string[] };
}): string[] {
  return operation.capabilities?.read ?? [];
}

export type ContractAnalysis = {
  namespaces: string[];
  rpc: {
    methods: Array<{
      key: string;
      subject: string;
      wildcardSubject: string;
      callerCapabilities: string[];
    }>;
  };
  operations: {
    operations: Array<{
      key: string;
      subject: string;
      wildcardSubject: string;
      controlSubject: string;
      wildcardControlSubject: string;
      callCapabilities: string[];
      readCapabilities: string[];
      cancelCapabilities: string[];
      cancel: boolean;
    }>;
    control: Array<{
      key: string;
      action: "get" | "wait" | "watch" | "cancel";
      subject: string;
      wildcardSubject: string;
      requiredCapabilities: string[];
    }>;
  };
  events: {
    events: Array<{
      key: string;
      subject: string;
      wildcardSubject: string;
      publishCapabilities: string[];
      subscribeCapabilities: string[];
    }>;
  };
  nats: {
    publish: Array<{
      kind:
        | "rpc:call"
        | "operation:call"
        | "operation:control"
        | "event:publish";
      subject: string;
      wildcardSubject: string;
      requiredCapabilities: string[];
    }>;
    subscribe: Array<{
      kind:
        | "rpc:handle"
        | "operation:handle"
        | "operation:control"
        | "event:subscribe";
      subject: string;
      wildcardSubject: string;
      requiredCapabilities: string[];
    }>;
  };
  resources: {
    kv: Array<{
      alias: string;
      purpose: string;
      required: boolean;
      history: number;
      ttlMs: number;
      maxValueBytes?: number;
    }>;
    store: Array<{
      alias: string;
      purpose: string;
      required: boolean;
      ttlMs: number;
      maxObjectBytes?: number;
      maxTotalBytes?: number;
    }>;
    jobs: Array<{
      queueType: string;
      payload: { schema: string };
      result?: { schema: string };
      maxDeliver: number;
      backoffMs: number[];
      ackWaitMs: number;
      defaultDeadlineMs?: number;
      progress: boolean;
      logs: boolean;
      dlq: boolean;
      concurrency: number;
    }>;
  };
};

export type ContractAnalysisSummary = {
  namespaces: string[];
  rpcMethods: number;
  operations: number;
  operationControls: number;
  events: number;
  natsPublish: number;
  natsSubscribe: number;
  kvResources: number;
  storeResources: number;
  jobsQueues: number;
};

export function analyzeContract(contract: TrellisContractV1): {
  analysis: ContractAnalysis;
  summary: ContractAnalysisSummary;
} {
  const rpcMethods: ContractAnalysis["rpc"]["methods"] = [];
  const operations: ContractAnalysis["operations"]["operations"] = [];
  const operationControls: ContractAnalysis["operations"]["control"] = [];
  const events: ContractAnalysis["events"]["events"] = [];
  const namespaces = new Set<string>();

  for (
    const [key, m] of Object.entries(contract.rpc ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["rpc"]>[string]]
    >
  ) {
    const wildcardSubject = templateToWildcard(m.subject);
    rpcMethods.push({
      key,
      subject: m.subject,
      wildcardSubject,
      callerCapabilities: m.capabilities?.call ?? [],
    });
    const ns = subjectNamespace(m.subject);
    if (ns) namespaces.add(ns);
  }

  for (
    const [key, operation] of Object.entries(
      contract.operations ?? {},
    ) as Array<
      [string, NonNullable<TrellisContractV1["operations"]>[string]]
    >
  ) {
    const wildcardSubject = templateToWildcard(operation.subject);
    const controlSubject = `${operation.subject}.control`;
    const wildcardControlSubject = templateToWildcard(controlSubject);
    const callCapabilities = operation.capabilities?.call ?? [];
    const readCapabilities = operationReadCapabilities(operation);
    const cancelCapabilities = operation.capabilities?.cancel ?? [];
    operations.push({
      key,
      subject: operation.subject,
      wildcardSubject,
      controlSubject,
      wildcardControlSubject,
      callCapabilities,
      readCapabilities,
      cancelCapabilities,
      cancel: operation.cancel ?? false,
    });
    operationControls.push(
      {
        key,
        action: "get",
        subject: controlSubject,
        wildcardSubject: wildcardControlSubject,
        requiredCapabilities: readCapabilities,
      },
      {
        key,
        action: "wait",
        subject: controlSubject,
        wildcardSubject: wildcardControlSubject,
        requiredCapabilities: readCapabilities,
      },
      {
        key,
        action: "watch",
        subject: controlSubject,
        wildcardSubject: wildcardControlSubject,
        requiredCapabilities: readCapabilities,
      },
    );
    if (operation.cancel) {
      operationControls.push({
        key,
        action: "cancel",
        subject: controlSubject,
        wildcardSubject: wildcardControlSubject,
        requiredCapabilities: cancelCapabilities,
      });
    }
    const ns = subjectNamespace(operation.subject);
    if (ns) namespaces.add(ns);
  }

  for (
    const [key, e] of Object.entries(contract.events ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["events"]>[string]]
    >
  ) {
    const wildcardSubject = templateToWildcard(e.subject);
    events.push({
      key,
      subject: e.subject,
      wildcardSubject,
      publishCapabilities: e.capabilities?.publish ?? [],
      subscribeCapabilities: e.capabilities?.subscribe ?? [],
    });
    const ns = subjectNamespace(e.subject);
    if (ns) namespaces.add(ns);
  }

  rpcMethods.sort((a, b) => a.subject.localeCompare(b.subject));
  operations.sort((a, b) => a.subject.localeCompare(b.subject));
  operationControls.sort((a, b) =>
    a.subject.localeCompare(b.subject) || a.action.localeCompare(b.action)
  );
  events.sort((a, b) => a.subject.localeCompare(b.subject));
  const publish: ContractAnalysis["nats"]["publish"] = [];
  const subscribe: ContractAnalysis["nats"]["subscribe"] = [];

  for (const m of rpcMethods) {
    publish.push({
      kind: "rpc:call",
      subject: m.subject,
      wildcardSubject: m.wildcardSubject,
      requiredCapabilities: m.callerCapabilities,
    });
  }

  for (const m of rpcMethods) {
    subscribe.push({
      kind: "rpc:handle",
      subject: m.subject,
      wildcardSubject: m.wildcardSubject,
      requiredCapabilities: ["service"],
    });
  }

  for (const operation of operations) {
    publish.push({
      kind: "operation:call",
      subject: operation.subject,
      wildcardSubject: operation.wildcardSubject,
      requiredCapabilities: operation.callCapabilities,
    });
    if (operation.readCapabilities.length > 0) {
      for (const _ of ["get", "wait", "watch"]) {
        publish.push({
          kind: "operation:control",
          subject: operation.controlSubject,
          wildcardSubject: operation.wildcardControlSubject,
          requiredCapabilities: operation.readCapabilities,
        });
      }
    }
    if (operation.cancel && operation.cancelCapabilities.length > 0) {
      publish.push({
        kind: "operation:control",
        subject: operation.controlSubject,
        wildcardSubject: operation.wildcardControlSubject,
        requiredCapabilities: operation.cancelCapabilities,
      });
    }
    subscribe.push(
      {
        kind: "operation:handle",
        subject: operation.subject,
        wildcardSubject: operation.wildcardSubject,
        requiredCapabilities: ["service"],
      },
      {
        kind: "operation:control",
        subject: operation.controlSubject,
        wildcardSubject: operation.wildcardControlSubject,
        requiredCapabilities: ["service"],
      },
    );
  }

  for (const e of events) {
    publish.push({
      kind: "event:publish",
      subject: e.subject,
      wildcardSubject: e.wildcardSubject,
      requiredCapabilities: e.publishCapabilities,
    });
    subscribe.push({
      kind: "event:subscribe",
      subject: e.subject,
      wildcardSubject: e.wildcardSubject,
      requiredCapabilities: e.subscribeCapabilities,
    });
  }

  const namespacesList = [...namespaces].sort((a, b) => a.localeCompare(b));
  const resourceAnalysis = getContractResourceAnalysis(contract);
  const resourceSummary = getContractResourceSummary(contract);

  const analysis: ContractAnalysis = {
    namespaces: namespacesList,
    rpc: { methods: rpcMethods },
    operations: { operations, control: operationControls },
    events: { events },
    nats: { publish, subscribe },
    resources: resourceAnalysis,
  };

  const summary: ContractAnalysisSummary = {
    namespaces: namespacesList,
    rpcMethods: rpcMethods.length,
    operations: operations.length,
    operationControls: operationControls.length,
    events: events.length,
    natsPublish: publish.length,
    natsSubscribe: subscribe.length,
    kvResources: resourceSummary.kvResources,
    storeResources: resourceSummary.storeResources,
    jobsQueues: resourceSummary.jobsQueues,
  };

  return { analysis, summary };
}
