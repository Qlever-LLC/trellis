import {
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
  IsoDateSchema,
} from "@qlever-llc/trellis/contracts";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";

export const ContractRecordSchema = Type.Object({
  digest: Type.String({ pattern: "^[A-Za-z0-9_-]+$" }),
  id: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  installedAt: IsoDateSchema,
  contract: Type.String({ minLength: 1 }),
  analysisSummary: Type.Optional(Type.Object({
    namespaces: Type.Array(Type.String()),
    rpcMethods: Type.Number(),
    operations: Type.Number({ default: 0 }),
    operationControls: Type.Number({ default: 0 }),
    events: Type.Number(),
    natsPublish: Type.Number(),
    natsSubscribe: Type.Number(),
    kvResources: Type.Number({ default: 0 }),
    storeResources: Type.Number({ default: 0 }),
    jobsQueues: Type.Number({ default: 0 }),
  }, { additionalProperties: false })),
  analysis: Type.Optional(Type.Object({
    namespaces: Type.Array(Type.String()),
    rpc: Type.Object({
      methods: Type.Array(Type.Object({
        key: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        callerCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    operations: Type.Object({
      operations: Type.Array(Type.Object({
        key: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        controlSubject: Type.String(),
        wildcardControlSubject: Type.String(),
        callCapabilities: Type.Array(Type.String()),
        readCapabilities: Type.Array(Type.String()),
        cancelCapabilities: Type.Array(Type.String()),
        cancel: Type.Boolean(),
      }, { additionalProperties: false })),
      control: Type.Array(Type.Object({
        key: Type.String(),
        action: Type.Union([
          Type.Literal("get"),
          Type.Literal("wait"),
          Type.Literal("watch"),
          Type.Literal("cancel"),
        ]),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        requiredCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    events: Type.Object({
      events: Type.Array(Type.Object({
        key: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        publishCapabilities: Type.Array(Type.String()),
        subscribeCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    nats: Type.Object({
      publish: Type.Array(Type.Object({
        kind: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        requiredCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
      subscribe: Type.Array(Type.Object({
        kind: Type.String(),
        subject: Type.String(),
        wildcardSubject: Type.String(),
        requiredCapabilities: Type.Array(Type.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    resources: Type.Object({
      kv: Type.Array(
        Type.Object({
          alias: Type.String({ minLength: 1 }),
          purpose: Type.String({ minLength: 1 }),
          required: Type.Boolean(),
          history: Type.Number(),
          ttlMs: Type.Number(),
          maxValueBytes: Type.Optional(Type.Number()),
        }, { additionalProperties: false }),
        { default: [] },
      ),
      store: Type.Array(
        Type.Object({
          alias: Type.String({ minLength: 1 }),
          purpose: Type.String({ minLength: 1 }),
          required: Type.Boolean(),
          ttlMs: Type.Number(),
          maxTotalBytes: Type.Optional(Type.Number()),
        }, { additionalProperties: false }),
        { default: [] },
      ),
      jobs: Type.Array(
        Type.Object({
          queueType: Type.String({ minLength: 1 }),
          payload: Type.Object({ schema: Type.String({ minLength: 1 }) }, {
            additionalProperties: false,
          }),
          result: Type.Optional(
            Type.Object({ schema: Type.String({ minLength: 1 }) }, {
              additionalProperties: false,
            }),
          ),
          maxDeliver: Type.Number(),
          backoffMs: Type.Array(Type.Number()),
          ackWaitMs: Type.Number(),
          defaultDeadlineMs: Type.Optional(Type.Number()),
          progress: Type.Boolean(),
          logs: Type.Boolean(),
          dlq: Type.Boolean(),
          concurrency: Type.Number(),
        }, { additionalProperties: false }),
        { default: [] },
      ),
    }, {
      additionalProperties: false,
      default: { kv: [], store: [], jobs: [] },
    }),
  }, { additionalProperties: false })),
  resources: Type.Optional(ContractResourcesSchema),
}, { additionalProperties: false });
export type ContractRecord = StaticDecode<typeof ContractRecordSchema>;
