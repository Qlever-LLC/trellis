import { defineServiceContract, type RpcName } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import * as errors from "../errors/index.ts";
import * as schemas from "../schemas/index.ts";
import type { ServiceRpcHandler } from "@qlever-llc/trellis/host";

export const contract = defineServiceContract(
  {
    schemas,
    errors,
  },
  (ref) => ({
    id: "trellis.demo-service@v1",
    displayName: "Demo Service",
    description:
      "Demo installable service with a groups RPC and a file processing workflow.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploaded files for the demo service.",
          ttlMs: 0,
          maxObjectBytes: 64 * 1024 * 1024,
          maxTotalBytes: 256 * 1024 * 1024,
        },
      },
      jobs: {
        queues: {
          "file-process": {
            payload: ref.schema("FilesProcessJobPayload"),
            result: ref.schema("FilesProcessResult"),
          },
        },
      },
    },
    rpc: {
      "Demo.Groups.List": {
        version: "v1",
        input: ref.schema("GroupsListRequest"),
        output: ref.schema("GroupsListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Demo.Files.Process.Start": {
        version: "v1",
        input: ref.schema("FilesProcessStartRequest"),
        output: ref.schema("FilesProcessStartResponse"),
        capabilities: { call: ["uploader"] },
        errors: [
          ref.error("ReservedUploadKeyError"),
          ref.error("TransferError"),
          ref.error("UnexpectedError"),
        ],
      },
    },
    operations: {
      "Demo.Files.Process": {
        version: "v1",
        input: ref.schema("FilesProcessStartRequest"),
        progress: ref.schema("FilesProcessProgress"),
        output: ref.schema("FilesProcessResult"),
        capabilities: {
          call: ["uploader"],
          read: ["uploader"],
        },
      },
    },
  }),
);

export default contract;
export type Rpc<T extends RpcName<typeof contract>> = ServiceRpcHandler<
  typeof contract,
  T
>;
