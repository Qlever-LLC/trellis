import type { TrellisContractV1 } from "@qlever-llc/trellis-contracts";

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
  if (parts[0] !== "rpc" && parts[0] !== "events") return null;
  if (!parts[1]?.startsWith("v")) return null;
  return parts[2] ?? null;
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
  events: {
    events: Array<{
      key: string;
      subject: string;
      wildcardSubject: string;
      publishCapabilities: string[];
      subscribeCapabilities: string[];
    }>;
  };
  subjects: {
    subjects: Array<{
      key: string;
      subject: string;
      publishCapabilities: string[];
      subscribeCapabilities: string[];
    }>;
  };
  nats: {
    publish: Array<{
      kind: "rpc:call" | "event:publish" | "subject:publish";
      subject: string;
      wildcardSubject: string;
      requiredCapabilities: string[];
    }>;
    subscribe: Array<{
      kind: "rpc:handle" | "event:subscribe" | "subject:subscribe";
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
    streams: Array<{
      alias: string;
      purpose: string;
      required: boolean;
      subjects: string[];
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
  events: number;
  natsPublish: number;
  natsSubscribe: number;
  kvResources: number;
  streamsResources: number;
  jobsQueues: number;
};

export function analyzeContract(contract: TrellisContractV1): {
  analysis: ContractAnalysis;
  summary: ContractAnalysisSummary;
} {
  const rpcMethods: ContractAnalysis["rpc"]["methods"] = [];
  const events: ContractAnalysis["events"]["events"] = [];
  const subjects: ContractAnalysis["subjects"]["subjects"] = [];
  const namespaces = new Set<string>();

  for (const [key, m] of Object.entries(contract.rpc ?? {})) {
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

  for (const [key, e] of Object.entries(contract.events ?? {})) {
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

  for (const [key, s] of Object.entries(contract.subjects ?? {})) {
    subjects.push({
      key,
      subject: s.subject,
      publishCapabilities: s.capabilities?.publish ?? [],
      subscribeCapabilities: s.capabilities?.subscribe ?? [],
    });
  }

  rpcMethods.sort((a, b) => a.subject.localeCompare(b.subject));
  events.sort((a, b) => a.subject.localeCompare(b.subject));
  subjects.sort((a, b) => a.subject.localeCompare(b.subject));

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

  for (const s of subjects) {
    publish.push({
      kind: "subject:publish",
      subject: s.subject,
      wildcardSubject: s.subject,
      requiredCapabilities: s.publishCapabilities,
    });
    subscribe.push({
      kind: "subject:subscribe",
      subject: s.subject,
      wildcardSubject: s.subject,
      requiredCapabilities: s.subscribeCapabilities,
    });
  }

  const namespacesList = [...namespaces].sort((a, b) => a.localeCompare(b));
  const resourceAnalysis = getContractResourceAnalysis(contract);
  const resourceSummary = getContractResourceSummary(contract);

  const analysis: ContractAnalysis = {
    namespaces: namespacesList,
    rpc: { methods: rpcMethods },
    events: { events },
    subjects: { subjects },
    nats: { publish, subscribe },
    resources: resourceAnalysis,
  };

  const summary: ContractAnalysisSummary = {
    namespaces: namespacesList,
    rpcMethods: rpcMethods.length,
    events: events.length,
    natsPublish: publish.length,
    natsSubscribe: subscribe.length,
    kvResources: resourceSummary.kvResources,
    streamsResources: resourceSummary.streamsResources,
    jobsQueues: resourceSummary.jobsQueues,
  };

  return { analysis, summary };
}
