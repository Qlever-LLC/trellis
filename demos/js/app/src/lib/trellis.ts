import { createAuthState } from "@qlever-llc/trellis-svelte";
import contract from "../../contract.ts";
import { PUBLIC_TRELLIS_URL } from "$env/static/public";
import type { BaseError } from "@qlever-llc/result";
import { AsyncResult, isErr } from "@qlever-llc/result";
import type {
  InspectionSummariesGetInput,
  InspectionSummariesGetOutput,
  InspectionSummariesListInput,
  InspectionSummariesListOutput,
} from "@trellis-demo/kv-service-sdk";
import type {
  InspectionSummariesRefreshInput,
  InspectionSummariesRefreshOutput,
  InspectionSummariesRefreshStatusGetInput,
  InspectionSummariesRefreshStatusGetOutput,
} from "@trellis-demo/jobs-service-sdk";
import type {
  InspectionReportGenerateInput,
  InspectionReportGenerateOutput,
  InspectionReportGenerateProgress,
} from "@trellis-demo/operation-service-sdk";
import type {
  InspectionAssignmentsListInput,
  InspectionAssignmentsListOutput,
  InspectionSitesGetSummaryInput,
  InspectionSitesGetSummaryOutput,
} from "@trellis-demo/rpc-service-sdk";
import type {
  InspectionEvidenceUploadInput,
  InspectionEvidenceUploadOutput,
  InspectionEvidenceUploadProgress,
} from "@trellis-demo/transfer-service-sdk";

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

function requirePublicTrellisUrl(): string {
  const value = PUBLIC_TRELLIS_URL?.trim();
  if (!value) {
    throw new Error(
      "Missing PUBLIC_TRELLIS_URL. Set it in demos/js/app/.env, shell env, or your build environment.",
    );
  }

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch (error) {
    throw new Error(
      `Invalid PUBLIC_TRELLIS_URL ${JSON.stringify(value)}: ${(error as Error).message}`,
    );
  }
}

export const trellisUrl = requirePublicTrellisUrl();

export const auth: ReturnType<typeof createAuthState> = createAuthState({
  authUrl: trellisUrl,
  contract,
  loginPath: "/login",
});
