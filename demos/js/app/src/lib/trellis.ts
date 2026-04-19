import type { BaseError } from "@qlever-llc/result";
import { AsyncResult, isErr } from "@qlever-llc/result";
import type {
  InspectionSummariesGetInput,
  InspectionSummariesGetOutput,
  InspectionSummariesListInput,
  InspectionSummariesListOutput,
} from "../../../../generated/js/sdks/demo-kv-service/types.ts";
import type {
  InspectionSummariesRefreshInput,
  InspectionSummariesRefreshOutput,
  InspectionSummariesRefreshStatusGetInput,
  InspectionSummariesRefreshStatusGetOutput,
} from "../../../../generated/js/sdks/demo-jobs-service/types.ts";
import type {
  InspectionReportGenerateInput,
  InspectionReportGenerateOutput,
  InspectionReportGenerateProgress,
} from "../../../../generated/js/sdks/demo-operation-service/types.ts";
import type {
  InspectionAssignmentsListInput,
  InspectionAssignmentsListOutput,
  InspectionSitesGetSummaryInput,
  InspectionSitesGetSummaryOutput,
} from "../../../../generated/js/sdks/demo-rpc-service/types.ts";
import type {
  InspectionEvidenceUploadInput,
  InspectionEvidenceUploadOutput,
  InspectionEvidenceUploadProgress,
} from "../../../../generated/js/sdks/demo-transfer-service/types.ts";

type AppRpcMap = {
  "Inspection.Assignments.List": {
    input: InspectionAssignmentsListInput;
    output: InspectionAssignmentsListOutput;
  };
  "Inspection.Sites.GetSummary": {
    input: InspectionSitesGetSummaryInput;
    output: InspectionSitesGetSummaryOutput;
  };
  "Inspection.Summaries.List": {
    input: InspectionSummariesListInput;
    output: InspectionSummariesListOutput;
  };
  "Inspection.Summaries.Get": {
    input: InspectionSummariesGetInput;
    output: InspectionSummariesGetOutput;
  };
  "Inspection.Summaries.Refresh": {
    input: InspectionSummariesRefreshInput;
    output: InspectionSummariesRefreshOutput;
  };
  "Inspection.Summaries.RefreshStatus.Get": {
    input: InspectionSummariesRefreshStatusGetInput;
    output: InspectionSummariesRefreshStatusGetOutput;
  };
};

type RpcMethodName = keyof AppRpcMap & string;

type ReportOperationRef = {
  id: string;
  operation: string;
  watch(): AsyncResult<
    AsyncIterable<{
      type: string;
      snapshot: {
        state: string;
      };
      progress?: InspectionReportGenerateProgress;
    }>,
    BaseError
  >;
  wait(): AsyncResult<
    {
      state: "completed" | "failed" | "cancelled";
      output?: InspectionReportGenerateOutput;
    },
    BaseError
  >;
  cancel(): AsyncResult<{ state: string }, BaseError>;
};

type TransferStart = {
  operation: {
    id: string;
  };
  wait(): AsyncResult<
    {
      terminal: {
        output?: InspectionEvidenceUploadOutput;
      };
    },
    BaseError
  >;
};

type TransferBuilder = {
  onTransfer(handler: (event: { transfer: { transferredBytes: number } }) => void): TransferBuilder;
  onProgress(handler: (event: { progress: InspectionEvidenceUploadProgress }) => void): TransferBuilder;
  start(): AsyncResult<TransferStart, BaseError>;
};

export type RpcAssignment = InspectionAssignmentsListOutput["assignments"][number];
export type RpcSiteSummary = NonNullable<InspectionSitesGetSummaryOutput["summary"]>;
export type KvSummary = InspectionSummariesListOutput["summaries"][number];
export type JobsRefresh = NonNullable<InspectionSummariesRefreshStatusGetOutput["refresh"]>;
export type ReportProgress = InspectionReportGenerateProgress;
export type ReportOutput = InspectionReportGenerateOutput;
export type TransferProgress = InspectionEvidenceUploadProgress;
export type TransferOutput = InspectionEvidenceUploadOutput;

type InspectionContextValue = {
  siteId: string;
  note: string;
  updatedBy: string;
  updatedAt: string;
};

export type AppStateEntry = {
  key: string;
  value: InspectionContextValue;
  revision: string;
  updatedAt: string;
  expiresAt?: string;
};

type AppStatePutResult =
  | { applied: true; entry: AppStateEntry }
  | { applied: false; found: boolean; entry?: AppStateEntry };

export type AppStatePutEntry = Extract<AppStatePutResult, { applied: true }>["entry"];

type AppStateStore = {
  get(key: string): AsyncResult<
    { found: false } | { found: true; entry: AppStateEntry },
    BaseError
  >;
  put(
    key: string,
    value: InspectionContextValue,
    opts?: {
      expectedRevision?: string | null;
      ttlMs?: number;
    },
  ): AsyncResult<AppStatePutResult, BaseError>;
  delete(
    key: string,
    opts?: { expectedRevision?: string },
  ): AsyncResult<{ deleted: boolean }, BaseError>;
  list(opts?: {
    prefix?: string;
    offset?: number;
    limit?: number;
  }): AsyncResult<{
    entries: AppStateEntry[];
    count: number;
    offset: number;
    limit: number;
    next?: number;
    prev?: number;
  }, BaseError>;
  prefix(path: string): AppStateStore;
};

type RuntimeAuthState = {
  authUrl: string | null;
  isAuthenticated: boolean;
  init(): Promise<unknown>;
  signIn(options?: {
    authUrl?: string;
    redirectTo?: string;
    landingPath?: string;
    context?: unknown;
  }): Promise<never>;
  setAuthUrl(authUrl: string): string;
};

type RuntimeContract = unknown;

type AppJobsWorkerInfo = {
  instanceId: string;
  jobType: string;
  timestamp: string;
};

type AppJobsServiceInfo = {
  healthy: boolean;
  name: string;
  workers: AppJobsWorkerInfo[];
};

type AppJobsSnapshot = {
  id: string;
  service: string;
  state: string;
  type: string;
  updatedAt: string;
};

type AppJobsFilter = {
  limit?: number;
  service?: string;
  state?: string | string[];
  since?: string;
  jobType?: string;
};

type AppJobsClient = {
  listServices(): AsyncResult<AppJobsServiceInfo[], BaseError>;
  list(filter?: AppJobsFilter): AsyncResult<AppJobsSnapshot[], BaseError>;
};

type AppRpcTrellis = {
  request<TMethod extends RpcMethodName>(
    method: TMethod,
    input: AppRpcMap[TMethod]["input"],
  ): AsyncResult<AppRpcMap[TMethod]["output"], BaseError>;
  request<T = unknown>(method: string, input: unknown): AsyncResult<T, BaseError>;
  operation(method: "Inspection.Report.Generate"): {
    input(input: InspectionReportGenerateInput): {
      start(): AsyncResult<ReportOperationRef, BaseError>;
    };
  };
  operation(method: "Inspection.Evidence.Upload"): {
    input(input: InspectionEvidenceUploadInput): {
      transfer(body: Uint8Array | ArrayBuffer): TransferBuilder;
    };
  };
  jobs(): AppJobsClient;
};

export type AppTrellis = AppRpcTrellis & {
  state: {
    inspectionContext: AppStateStore;
  };
};

export const trellisUrl = "http://localhost:3000";

const trellisSvelteModulePath = "../../../../js/packages/" + "trellis-svelte/src/index.ts";
const contractModulePath = "../../contracts/" + "demo_inspection_app.ts";

let runtimeAuthState: RuntimeAuthState | null = null;
let pendingAuthUrl = trellisUrl;
let runtimeContract: RuntimeContract | null = null;

async function loadTrellisSvelteModule(): Promise<{
  createAuthState(config: {
    authUrl?: string;
    loginPath?: string;
    contract?: unknown;
  }): RuntimeAuthState;
  getTrellis<T = unknown>(): Promise<T>;
}> {
  return await import(/* @vite-ignore */ trellisSvelteModulePath);
}

export async function getContract(): Promise<RuntimeContract> {
  if (runtimeContract) {
    return runtimeContract;
  }

  const mod = await import(/* @vite-ignore */ contractModulePath);
  runtimeContract = mod.default;
  return runtimeContract;
}

async function ensureRuntimeAuthState(): Promise<RuntimeAuthState> {
  if (runtimeAuthState) {
    return runtimeAuthState;
  }

  const mod = await loadTrellisSvelteModule();
  runtimeAuthState = mod.createAuthState({
    authUrl: pendingAuthUrl,
    contract: await getContract(),
    loginPath: "/login",
  });
  return runtimeAuthState;
}

class AppAuth {
  get authUrl(): string | null {
    return runtimeAuthState?.authUrl ?? pendingAuthUrl;
  }

  get isAuthenticated(): boolean {
    return runtimeAuthState?.isAuthenticated ?? false;
  }

  async init(): Promise<unknown> {
    const state = await ensureRuntimeAuthState();
    return await state.init();
  }

  async signIn(options?: {
    authUrl?: string;
    redirectTo?: string;
    landingPath?: string;
    context?: unknown;
  }): Promise<never> {
    const state = await ensureRuntimeAuthState();
    return await state.signIn(options);
  }

  setAuthUrl(authUrl: string): string {
    pendingAuthUrl = authUrl;
    if (runtimeAuthState) {
      return runtimeAuthState.setAuthUrl(authUrl);
    }
    return authUrl;
  }
}

export const auth = new AppAuth();

export function getTrellis() {
  return loadTrellisSvelteModule().then((mod) => mod.getTrellis<AppTrellis>());
}

export async function requestValue<TMethod extends RpcMethodName>(
  method: TMethod,
  input: AppRpcMap[TMethod]["input"],
): Promise<AppRpcMap[TMethod]["output"]> {
  const trellis = await getTrellis() as AppRpcTrellis;
  const result = await trellis.request(method, input);
  const value = result.take();

  if (isErr(value)) {
    throw value.error;
  }

  return value as AppRpcMap[TMethod]["output"];
}

export async function getJobsClient(): Promise<AppJobsClient> {
  const trellis = await getTrellis() as AppRpcTrellis;
  return trellis.jobs();
}
