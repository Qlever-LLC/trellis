// @ts-nocheck

import {
  type Consumer,
  type JetStreamClient,
  jetstream,
  jetstreamManager,
} from "@nats-io/jetstream";
import {
  createInbox,
  type Msg,
  type NatsConnection,
  headers as natsHeaders,
} from "@nats-io/nats-core";
import type {
  EventDesc,
  InferSchemaType,
  RPCDesc,
  TrellisAPI,
} from "@qlever-llc/trellis-contracts";
import {
  AsyncResult,
  type BaseError,
  err,
  type InferErr,
  isErr,
  type MaybeAsync,
  ok,
  Result,
} from "@qlever-llc/trellis-result";
import { API as trellisCoreApi } from "@qlever-llc/trellis-sdk-core";
import {
  context,
  createNatsHeaderCarrier,
  extractTraceContext,
  injectTraceContext,
  SpanStatusCode,startClientSpan, startServerSpan, 
  trace,
  withSpanAsync
} from "@qlever-llc/trellis-telemetry";
import type { Logger } from "pino";
import { Type } from "typebox";
import { AssertError, Pointer } from "typebox/value";
import { ulid } from "ulid";
import { encodeSchema, type JsonValue, parse, parseSchema } from "./codec.ts";
import {
  AuthError,
  type TrellisErrorInstance,
  UnexpectedError,
  ValidationError,
} from "./errors/index.ts";
import { RemoteError } from "./errors/RemoteError.ts";
import { logger } from "./globals.ts";
import { TypedKV } from "./kv.ts";
import { TrellisErrorDataSchema } from "./models/trellis/TrellisError.ts";
import {
  OperationInvoker,
  type OperationRefData,
  type OperationTransport,
} from "./operations.ts";
import { TrellisTasks } from "./tasks.ts";

type SessionUser = {
  id: string;
  origin: string;
  active: boolean;
  name: string;
  email: string;
  image?: string;
  capabilities: string[];
  lastLogin?: string;
};

/**
 * Safely extract JSON from a NATS message.
 * The .json() method can throw if the message data is not valid JSON.
 */
function safeJson(msg: Msg): Result<JsonValue, UnexpectedError> {
  return Result.try(() => msg.json() as JsonValue);
}

function base64urlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(s: string): Uint8Array {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buf = data.buffer;
  if (buf instanceof ArrayBuffer) {
    return buf.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(digest);
}

function buildProofInput(
  sessionKey: string,
  subject: string,
  payloadHash: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const sessionKeyBytes = enc.encode(sessionKey);
  const subjectBytes = enc.encode(subject);

  const buf = new Uint8Array(
    4 +
      sessionKeyBytes.length +
      4 +
      subjectBytes.length +
      4 +
      payloadHash.length,
  );
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, sessionKeyBytes.length);
  offset += 4;
  buf.set(sessionKeyBytes, offset);
  offset += sessionKeyBytes.length;

  view.setUint32(offset, subjectBytes.length);
  offset += 4;
  buf.set(subjectBytes, offset);
  offset += subjectBytes.length;

  view.setUint32(offset, payloadHash.length);
  offset += 4;
  buf.set(payloadHash, offset);

  return buf;
}

export type TrellisSigner = (
  data: Uint8Array,
) => Promise<Uint8Array> | Uint8Array;

export type TrellisAuth = {
  sessionKey: string;
  sign: TrellisSigner;
};

type AnyTrellisAPI = TrellisAPI;
type MethodsOf<TA extends AnyTrellisAPI> = keyof TA["rpc"] & string;
type OperationsOf<TA extends AnyTrellisAPI> = keyof TA["operations"] & string;
type EventsOf<TA extends AnyTrellisAPI> = keyof TA["events"] & string;
type MethodInputOf<TA extends AnyTrellisAPI, M extends MethodsOf<TA>> =
  InferSchemaType<TA["rpc"][M]["input"]>;
type MethodOutputOf<TA extends AnyTrellisAPI, M extends MethodsOf<TA>> =
  InferSchemaType<TA["rpc"][M]["output"]>;
type EventOf<TA extends AnyTrellisAPI, E extends EventsOf<TA>> =
  InferSchemaType<TA["events"][E]["event"]>;
type EventPayloadOf<TA extends AnyTrellisAPI, E extends EventsOf<TA>> = Omit<
  EventOf<TA, E>,
  "header"
>;
type OperationInputOf<TA extends AnyTrellisAPI, O extends OperationsOf<TA>> =
  InferSchemaType<TA["operations"][O]["input"]>;
type RuntimeOperationDesc = {
  subject: string;
  input: unknown;
  progress?: unknown;
  output?: unknown;
  cancel?: boolean;
};

type RuntimeOperationState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

type RuntimeOperationSnapshot = {
  id: string;
  service: string;
  operation: string;
  revision: number;
  state: RuntimeOperationState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress?: unknown;
  output?: unknown;
  error?: {
    type: string;
    message: string;
  };
};

type RuntimeOperationRecord = {
  id: string;
  service: string;
  operation: string;
  ownerSessionKey: string;
  snapshot: RuntimeOperationSnapshot;
  sequence: number;
  terminal: boolean;
  watchers: Set<string>;
  waiters: Set<string>;
};

type DurableOperationRecord = {
  ownerSessionKey: string;
  sequence: number;
  snapshot: RuntimeOperationSnapshot;
};

const DurableOperationSnapshotSchema = Type.Object({
  id: Type.String(),
  service: Type.String(),
  operation: Type.String(),
  revision: Type.Number(),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
  ]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
  progress: Type.Optional(Type.Any()),
  output: Type.Optional(Type.Any()),
  error: Type.Optional(Type.Object({
    type: Type.String(),
    message: Type.String(),
  })),
});

const DurableOperationRecordSchema = Type.Object({
  ownerSessionKey: Type.String(),
  sequence: Type.Number(),
  snapshot: DurableOperationSnapshotSchema,
});

type RuntimeOperationAcceptedEnvelope = {
  kind: "accepted";
  ref: OperationRefData;
  snapshot: RuntimeOperationSnapshot;
};

type RuntimeOperationControlRequest = {
  action: "get" | "wait" | "watch" | "cancel";
  operationId: string;
};

type RuntimeOperationController = {
  get(operationId: string): Promise<Result<RuntimeOperationSnapshot, UnexpectedError>>;
  started(operationId: string): Promise<Result<RuntimeOperationSnapshot, UnexpectedError>>;
  progress(
    operationId: string,
    progress: unknown,
  ): Promise<Result<RuntimeOperationSnapshot, UnexpectedError>>;
  complete(
    operationId: string,
    output: unknown,
  ): Promise<Result<RuntimeOperationSnapshot, UnexpectedError>>;
  fail(
    operationId: string,
    error: BaseError,
  ): Promise<Result<RuntimeOperationSnapshot, UnexpectedError>>;
  cancel(operationId: string): Promise<Result<RuntimeOperationSnapshot, UnexpectedError>>;
};

function buildRuntimeOperationSnapshot(
  runtime: Pick<RuntimeOperationRecord, "id" | "service" | "operation" | "snapshot">,
  state: RuntimeOperationState,
  patch?: Partial<RuntimeOperationSnapshot>,
): RuntimeOperationSnapshot {
  const updatedAt = new Date().toISOString();
  const completedAt = state === "completed" || state === "failed" || state === "cancelled"
    ? (patch?.completedAt ?? updatedAt)
    : patch?.completedAt;
  return {
    id: runtime.id,
    service: runtime.service,
    operation: runtime.operation,
    revision: patch?.revision ?? runtime.snapshot.revision + 1,
    state,
    createdAt: patch?.createdAt ?? runtime.snapshot.createdAt,
    updatedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(patch?.progress !== undefined ? { progress: patch.progress } : runtime.snapshot.progress !== undefined ? { progress: runtime.snapshot.progress } : {}),
    ...(patch?.output !== undefined ? { output: patch.output } : runtime.snapshot.output !== undefined ? { output: runtime.snapshot.output } : {}),
    ...(patch?.error ? { error: patch.error } : runtime.snapshot.error ? { error: runtime.snapshot.error } : {}),
  };
}

function isRuntimeOperationSnapshot(value: unknown): value is RuntimeOperationSnapshot {
  return !!value && typeof value === "object" &&
    typeof (value as RuntimeOperationSnapshot).id === "string" &&
    typeof (value as RuntimeOperationSnapshot).service === "string" &&
    typeof (value as RuntimeOperationSnapshot).operation === "string" &&
    typeof (value as RuntimeOperationSnapshot).revision === "number" &&
    typeof (value as RuntimeOperationSnapshot).state === "string" &&
    typeof (value as RuntimeOperationSnapshot).createdAt === "string" &&
    typeof (value as RuntimeOperationSnapshot).updatedAt === "string";
}

function isTerminalRuntimeOperationSnapshot(
  value: unknown,
): value is RuntimeOperationSnapshot {
  return isRuntimeOperationSnapshot(value) && (
    value.state === "completed" || value.state === "failed" || value.state === "cancelled"
  );
}

type NoResponderRetryOpts = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

type TrellisOpts<TA extends AnyTrellisAPI> = {
  log?: Logger;
  timeout?: number;
  stream?: string;
  noResponderRetry?: NoResponderRetryOpts;
  api?: TA;
  authBypassMethods?: string[];
};

type RequestOpts = {
  timeout?: number;
};

type HandlerFn<TA extends AnyTrellisAPI, M extends MethodsOf<TA>> = (
  m: MethodInputOf<TA, M>,
  context: { user: SessionUser; sessionKey: string },
) => Promise<Result<MethodOutputOf<TA, M>, TrellisErrorInstance>>;

type DeepRecord<T> = {
  [k: string]: T | DeepRecord<T>;
};

const NATS_SUBJECT_TOKEN_FORBIDDEN = /[\u0000\s.*>~]/gu;

const DEFAULT_NO_RESPONDER_MAX_RETRIES = 2;
const DEFAULT_NO_RESPONDER_RETRY_MS = 200;

type AuthCacheEntry = {
  user: SessionUser;
  expires: number;
};

export class Trellis<TA extends AnyTrellisAPI = typeof trellisCoreApi> {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;

  private nats: NatsConnection;
  private js: JetStreamClient;
  protected auth: TrellisAuth;
  readonly api: TA;
  #log: Logger;
  #tasks: TrellisTasks;
  #noResponderMaxRetries: number;
  #noResponderRetryMs: number;
  #authBypassMethods: Set<string>;
  #operationStore?: Promise<TypedKV<typeof DurableOperationRecordSchema>>;

  constructor(
    name: string, // Must be unique for a service
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: TrellisOpts<TA>,
  ) {
    this.name = name;
    this.nats = nats;
    this.js = jetstream(this.nats);
    this.auth = auth as TrellisAuth;
    this.api = (opts?.api ?? (trellisCoreApi as unknown as TA)) as TA;
    this.#log = (opts?.log ?? logger).child({ lib: "trellis" });
    this.timeout = opts?.timeout ?? 3000;
    this.stream = opts?.stream ?? "trellis";
    this.#noResponderMaxRetries = opts?.noResponderRetry?.maxAttempts ??
      DEFAULT_NO_RESPONDER_MAX_RETRIES;
    this.#noResponderRetryMs = opts?.noResponderRetry?.baseDelayMs ??
      DEFAULT_NO_RESPONDER_RETRY_MS;
    this.#authBypassMethods = new Set(opts?.authBypassMethods ?? []);

    this.#tasks = new TrellisTasks({ log: this.#log });
  }

  /**
   * Returns the underlying NATS connection.
   */
  get natsConnection(): NatsConnection {
    return this.nats;
  }

  async operationStoreHandle(): Promise<TypedKV<typeof DurableOperationRecordSchema>> {
    if (!this.#operationStore) {
      const bucket = `trellis_operations_${this.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      this.#operationStore = (async () => {
        const result = await TypedKV.open(
          this.nats,
          bucket,
          DurableOperationRecordSchema,
          {
            history: 5,
            ttl: 0,
          },
        );
        const value = result.take();
        if (isErr(value)) {
          throw value.error;
        }
        return value;
      })();
    }
    return this.#operationStore;
  }

  async loadOperationRecord(operationId: string): Promise<DurableOperationRecord | null> {
    const store = await this.operationStoreHandle();
    const entry = await store.get(operationId);
    const value = entry.take();
    if (isErr(value)) {
      return null;
    }
    return value.value as DurableOperationRecord;
  }

  async saveOperationRecord(runtime: RuntimeOperationRecord): Promise<void> {
    const store = await this.operationStoreHandle();
    const record: DurableOperationRecord = {
      ownerSessionKey: runtime.ownerSessionKey,
      sequence: runtime.sequence,
      snapshot: runtime.snapshot,
    };
    await store.put(runtime.id, record);
  }

  /**
   * Makes an authenticated request to a Trellis RPC method.
   *
   * @template M The specific RPC method being called.
   * @param method The name of the RPC method to call.
   * @param input The input data for the method, conforming to its schema.
   * @param opts Optional request-specific options.
   * @returns A promise that resolves with a `Result` containing either the method's
   * output or an error.
   * @returns A `Result` object:
   *              ok: A validated reponse of method M
   *              err: RemoteError | ValidationError | UnexpectedError
   */
  // TypeScript hits recursion limits on this generic surface under the app's Svelte check.
  // The implementation still builds and is exercised by runtime validation below.
  // @ts-expect-error
  async request<M extends MethodsOf<TA>>(
    method: M,
    input: MethodInputOf<TA, M>,
    opts?: RequestOpts,
  ): Promise<
    Result<
      MethodOutputOf<TA, M>,
      RemoteError | ValidationError | UnexpectedError
    >
  > {
    this.#log.trace({ method: String(method), input: input as unknown }, `Calling ${method.toString()}.`);

    const ctx = this.api["rpc"][method];
    if (!ctx) {
      return err(
        new UnexpectedError({
          cause: new Error(
            `Unknown RPC method '${method.toString()}'. Did you forget to include its API module?`,
          ),
          context: { method: method.toString() },
        }),
      );
    }

    const msg = encodeSchema(ctx.input, input).take();
    if (isErr(msg)) {
      return msg;
    }

    const subject = this.template(ctx.subject, input).take();
    if (isErr(subject)) {
      return subject;
    }

    // Start a client span for this RPC request
    const span = startClientSpan(method, subject);

    const attempt = async (): Promise<
      Result<
        MethodOutputOf<TA, M>,
        RemoteError | ValidationError | UnexpectedError
      >
    > => {
      const proof = await this.#createProof(subject, msg);

      const headers = natsHeaders();
      headers.set("session-key", this.auth.sessionKey);
      headers.set("proof", proof);

      // Inject trace context into NATS headers for propagation
      injectTraceContext(createNatsHeaderCarrier(headers), span);

      // Attempt request with retry for transient "no responders" errors
      const requestWithRetry = async (): Promise<
        Result<Msg, UnexpectedError>
      > => {
        for (let retry = 0; retry <= this.#noResponderMaxRetries; retry++) {
          const result = await AsyncResult.try(() =>
            this.nats.request(subject, msg, {
              headers,
              timeout: opts?.timeout ?? this.timeout,
            })
          );

          if (result.isOk()) {
            return ok((await result).take() as Msg);
          }

          const cause = result.error.cause;
          const message = cause instanceof Error
            ? cause.message
            : String(cause);
          const isNoResponders = message.includes("no responders");

          // If it's a no-responders error and we have retries left, retry
          if (isNoResponders && retry < this.#noResponderMaxRetries) {
            this.#log.debug(
              { method, subject, retry },
              "No responders, retrying...",
            );
            await new Promise((r) =>
              setTimeout(r, this.#noResponderRetryMs * (retry + 1))
            );
            continue;
          }

          // Final attempt failed or non-retryable error
          this.#log.warn(
            { method, subject, error: message },
            "NATS request failed",
          );
          const isNatsPermission = message.includes("Permissions Violation");
          const reason = isNatsPermission
            ? `Permission denied. You need one of these capabilities: ${
              ctx.callerCapabilities.join(
                ", ",
              )
            }`
            : message;
          return err(
            new UnexpectedError({
              cause,
              context: {
                method,
                subject,
                reason,
                requiredCapabilities: ctx.callerCapabilities,
                noResponders: isNoResponders,
              },
            }),
          );
        }
        // Should be unreachable, but TypeScript needs explicit return
        return err(
          new UnexpectedError({
            context: { method, subject, reason: "retry loop exhausted" },
          }),
        );
      };

      const msgResult = await requestWithRetry();
      const m = msgResult.take();
      if (isErr(m)) {
        return m;
      }

      if (m.headers?.get("status") === "error") {
        const json = safeJson(m).take();
        if (isErr(json)) {
          return json;
        }

        const error = parse(TrellisErrorDataSchema, json).take();
        if (isErr(error)) {
          return error;
        }

        return err(new RemoteError({ error }));
      }

      const json = safeJson(m).take();
      if (isErr(json)) {
        return json;
      }

      const outputResult = parseSchema(ctx.output, json);
      if (outputResult.isErr()) {
        return outputResult as Result<
          never,
          ValidationError | UnexpectedError
        >;
      }

      const output = outputResult.take();
      return ok(output as MethodOutputOf<TA, M>);
    };

    return withSpanAsync(span, async () => {
      try {
        const result = await attempt();

        const value = result.take();
        if (isErr(value)) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: value.error.message,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        return result;
      } catch (cause) {
        const unexpected = new UnexpectedError({ cause });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: unexpected.message,
        });
        span.recordException(unexpected);
        return err(unexpected);
      } finally {
        span.end();
      }
    });
  }

  async requestOrThrow<M extends MethodsOf<TA>>(
    method: M,
    input: MethodInputOf<TA, M>,
    opts?: RequestOpts,
  ): Promise<MethodOutputOf<TA, M>> {
    const result = await this.request(method, input, opts);
    const value = result.take();
    if (isErr(value)) {
      throw value.error;
    }

    return value;
  }

  operation<O extends OperationsOf<TA>>(
    operation: O,
  ): OperationInvoker<TA["operations"][O] & RuntimeOperationDesc> {
    const descriptor = this.api["operations"]?.[operation];
    if (!descriptor) {
      throw new Error(
        `Unknown operation '${operation.toString()}'. Did you forget to include its API module?`,
      );
    }

    const transport: OperationTransport = {
      requestJson: (subject, body) => this.#requestJson(subject, body),
      watchJson: (subject, body) => this.#watchJson(subject, body),
    };

    return new OperationInvoker(
      transport,
      descriptor as TA["operations"][O] & RuntimeOperationDesc,
    );
  }

  /*
   * Mount a handler to process requests made to a specific Trellis API
   */
  async mount<M extends MethodsOf<TA>>(method: M, fn: HandlerFn<TA, M>) {
    this.#tasks.add(method, this.#handleRPC(method, fn));
  }

  #handleRPC<M extends MethodsOf<TA>>(
    method: M,
    fn: HandlerFn<TA, M>,
    subjectData: Partial<MethodInputOf<TA, M>> = {},
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    // Get API details
    const ctx = this.api["rpc"][method] as TA["rpc"][M];

    const subject = this.template(ctx.subject, subjectData, true).take();
    if (isErr(subject)) {
      return AsyncResult.lift(subject);
    }

    this.#log.info({ method: String(method) }, `Mounting ${method.toString()} RPC handler`);
    const sub = this.nats.subscribe(subject);

    return AsyncResult.try(async () => {
      for await (const msg of sub) {
        const resultPromise = await this.#processRPCMessage(
          method,
          ctx,
          msg,
          fn,
        );
        const result = resultPromise.take();

        if (isErr(result)) {
          this.#respondWithError(msg, result.error);
          continue;
        }

        msg.respond(result);
      }
    });
  }

  async #processRPCMessage<M extends MethodsOf<TA>>(
    method: M,
    ctx: TA["rpc"][M],
    msg: Msg,
    fn: HandlerFn<TA, M>,
  ): Promise<Result<string, TrellisErrorInstance>> {
          this.#log.debug({ method: String(method), subject: msg.subject }, "Processing RPC message");

    // Extract trace context from incoming NATS headers
    const parentContext = extractTraceContext(
      createNatsHeaderCarrier({
        get: (k) => msg.headers?.get(k) ?? undefined,
        set: () => {}, // Server doesn't need to set headers on incoming messages
      }),
    );

    // Start a server span for this RPC handler
    const span = startServerSpan(method, msg.subject, parentContext);

    // Execute the handler within the span's context
    return withSpanAsync(span, async () => {
      const execute = async (): Promise<
        Result<string, TrellisErrorInstance | UnexpectedError>
      > => {
        const jsonData = safeJson(msg).take();
        if (isErr(jsonData)) {
          this.#log.warn(
            { method, error: jsonData.error.message },
            "Failed to parse JSON",
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse JSON",
          });
          return jsonData;
        }

        const parsedInput = parseSchema(ctx.input, jsonData).take();
        if (isErr(parsedInput)) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Input validation failed",
          });
          return parsedInput as Result<string, TrellisErrorInstance>;
        }

        let user: SessionUser;
        const callerSessionKey = msg.headers?.get("session-key") ?? "";

        const authRequired = ctx.authRequired ?? true;
        if (!authRequired || this.#authBypassMethods.has(method)) {
          user = {
            id: "system",
            origin: "trellis",
            active: true,
            name: "System",
            email: "system@trellis.internal",
            capabilities: ["service"],
          };
        } else {
          const sessionKey = msg.headers?.get("session-key");
          const proof = msg.headers?.get("proof");
          if (!sessionKey) {
            this.#log.warn({ method }, "Missing session-key header");
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Missing session-key",
            });
            return err(new AuthError({ reason: "missing_session_key" }));
          }
          if (!proof) {
            this.#log.warn({ method }, "Missing proof in request");
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Missing proof",
            });
            return err(new AuthError({ reason: "missing_proof" }));
          }

          // Verify proof signature locally using the raw request bytes we received.
          const payloadBytes = msg.data ?? new Uint8Array();
          const payloadHash = await sha256(payloadBytes);
          const proofInput = buildProofInput(
            sessionKey,
            msg.subject,
            payloadHash,
          );
          const digest = await sha256(proofInput);

          const verifyResult = await AsyncResult.try(async () => {
            const publicKeyRaw = base64urlDecode(sessionKey);
            const pub = await crypto.subtle.importKey(
              "raw",
              toArrayBuffer(publicKeyRaw),
              { name: "Ed25519" },
              true,
              ["verify"],
            );
            return crypto.subtle.verify(
              { name: "Ed25519" },
              pub,
              toArrayBuffer(base64urlDecode(proof)),
              toArrayBuffer(digest),
            );
          });
          const signatureOk = verifyResult.isOk() &&
            (await verifyResult).take() === true;

          if (!signatureOk) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Invalid signature",
            });
            return err(
              new AuthError({
                reason: "invalid_signature",
                context: { sessionKey },
              }),
            );
          }

          const authResult = await this.request("Auth.ValidateRequest", {
            sessionKey,
            proof,
            subject: msg.subject,
            payloadHash: base64urlEncode(payloadHash),
            capabilities: ctx.callerCapabilities,
          } as unknown as MethodInputOf<TA, "Auth.ValidateRequest">);
          const auth = authResult.take();
          if (isErr(auth)) {
            this.#log.warn(
              {
                method,
                error: auth.error.message,
                errorType: auth.error.name,
                remoteError: auth.error instanceof RemoteError
                  ? auth.error.toSerializable()
                  : undefined,
              },
              "Auth.ValidateRequest failed",
            );
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Auth.ValidateRequest failed",
            });
            return auth;
          }

          if (!auth.allowed) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Insufficient permissions",
            });
            return err(
              new AuthError({
                reason: "insufficient_permissions",
                context: {
                    requiredCapabilities: ctx.callerCapabilities,
                    userCapabilities: auth.user.capabilities,
                  },
                }),
              );
          }

          if (
            typeof msg.reply !== "string" ||
            !msg.reply.startsWith(`${auth.inboxPrefix}.`)
          ) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Reply subject mismatch",
            });
            return err(
              new AuthError({
                reason: "reply_subject_mismatch",
                context: { expected: auth.inboxPrefix, actual: msg.reply },
              }),
            );
          }

          user = auth.user;
        }

        // Add user info to span attributes
        span.setAttribute("user.id", user.id);
        span.setAttribute("user.origin", user.origin);

        const handlerResultWrapped = await AsyncResult.try(() =>
          fn(parsedInput as MethodInputOf<TA, M>, {
            user,
            sessionKey: callerSessionKey,
          })
        );

        if (handlerResultWrapped.isErr()) {
          const error = handlerResultWrapped.error.withContext({ method });
          this.#log.error(
            {
              method,
              error: error.message,
              cause: error.cause instanceof Error
                ? { message: error.cause.message, stack: error.cause.stack }
                : error.cause,
            },
            "Handler threw unexpectedly.",
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          span.recordException(error);
          return err(error);
        }

        const handlerResult = (await handlerResultWrapped).take() as Result<
          MethodOutputOf<TA, M>,
          TrellisErrorInstance
        >;
        const handlerOutcome = handlerResult.take();
        if (isErr(handlerOutcome)) {
          const handlerError = handlerOutcome.error;

          const error = handlerError instanceof UnexpectedError ||
              handlerError instanceof AuthError ||
              handlerError instanceof ValidationError
            ? handlerError
            : new UnexpectedError({ cause: handlerError });

          this.#log.error(
            {
              method,
              error: error.message,
              errorType: error.name,
              cause: error.cause instanceof Error
                ? { message: error.cause.message, stack: error.cause.stack }
                : error.cause,
            },
            "Handler returned error.",
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          return err(error);
        }

        const encoded = encodeSchema(ctx.output, handlerOutcome).take();
        if (isErr(encoded)) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Output encoding failed",
          });
          return encoded;
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return ok(encoded);
      };

      const result = await execute();
      span.end();
      return result;
    });
  }

  #respondWithError(msg: Msg, error: Error | TrellisErrorInstance): void {
    const trellisError = error instanceof UnexpectedError ||
        error instanceof AuthError ||
        error instanceof ValidationError ||
        error instanceof RemoteError
      ? error
      : new UnexpectedError({ cause: error });

    this.#log.error({ error: trellisError.toSerializable() }, "RPC error");

    const errorData = trellisError.toSerializable();
    const hdrs = natsHeaders();
    hdrs.set("status", "error");

    const serialized = Result.try(() => JSON.stringify(errorData));
    if (serialized.isErr()) {
      this.#log.error({ error: serialized.error }, "Failed to serialize error response");
      msg.respond(
        '{"type":"UnexpectedError","message":"Failed to serialize error"}',
        { headers: hdrs },
      );
      return;
    }
    msg.respond(serialized.take() as string, { headers: hdrs });
  }

  respondWithError(msg: Msg, error: Error | TrellisErrorInstance): void {
    this.#respondWithError(msg, error);
  }

  async publish<E extends EventsOf<TA>>(
    event: E,
    data: EventPayloadOf<TA, E>,
  ): Promise<Result<void, ValidationError | UnexpectedError>> {
    const ctx = this.api["events"][event];
    if (!ctx) {
      return err(
        new UnexpectedError({
          cause: new Error(
            `Unknown event '${event.toString()}'. Did you forget to include its API module?`,
          ),
          context: { event: event.toString() },
        }),
      );
    }

    const subject = this.template(ctx.subject, data).take();
    if (isErr(subject)) {
      logger.error({ err: subject.error }, "Failed to template event.");
      return subject;
    }

    const msg = encodeSchema(ctx.event, {
      ...data,
      header: {
        id: ulid(),
        time: new Date().toISOString(),
      },
    }).take();
    if (isErr(msg)) {
      logger.error({ err: msg.error }, "Failed to encode event.");
      return msg;
    }

    logger.trace({ subject }, `Publishing ${event.toString()} event.`);
    await this.js.publish(subject, msg);
    return ok(undefined);
  }

  async event<E extends EventsOf<TA>>(
    event: E,
    subjectData: DeepRecord<string | number | boolean>,
    fn: (m: EventOf<TA, E>) => MaybeAsync<void, BaseError>,
  ): Promise<Result<void, ValidationError | UnexpectedError>> {
    const ctx = this.api["events"][event];
    if (!ctx) {
      return err(
        new UnexpectedError({
          cause: new Error(
            `Unknown event '${event.toString()}'. Did you forget to include its API module?`,
          ),
          context: { event: event.toString() },
        }),
      );
    }
    const jsm = await jetstreamManager(this.nats);

    const subject = this.template(ctx.subject, subjectData, true).take();
    if (isErr(subject)) return subject;

    const consumerName = `${this.name}-${event.replaceAll(".", "_")}`;
    const addResult = await AsyncResult.try(() =>
      jsm.consumers.add(this.stream, {
        durable_name: consumerName,
        ack_policy: "explicit",
        deliver_policy: "all",
        filter_subjects: [subject],
      })
    );

    // If add failed (consumer already exists), try to get existing consumer info
    const consumerInfoResult = addResult.isOk()
      ? addResult
      : await AsyncResult.try(() => jsm.consumers.info(this.stream, consumerName));

    const info = consumerInfoResult.take();
    if (isErr(info)) return info;

    const consumer = this.js.consumers.getConsumerFromInfo(info);

    this.#tasks.add(event, this.#handleEvent(event, consumer, fn));
    return ok(undefined);
  }

  #handleEvent<E extends EventsOf<TA>>(
    event: E,
    consumer: Consumer,
    fn: (m: EventOf<TA, E>) => MaybeAsync<void, BaseError>,
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    const ctx = this.api["events"][event];

    return AsyncResult.try(async () => {
      const msgs = await consumer.consume();

      for await (const msg of msgs) {
        const jsonData = Result.try<JsonValue>(() => msg.json());
        if (jsonData.isErr()) {
          this.#log.error({ error: jsonData.error }, "Event parse failed");
          msg.term();
          continue;
        }

        const m = parseSchema(ctx.event, jsonData.take() as JsonValue).take();
        if (isErr(m)) {
          this.#log.error({ error: m.error }, "Event validation failed");
          msg.term();
          continue;
        }

        const handlerResult = await AsyncResult.lift(fn(m as EventOf<TA, E>));
        if (handlerResult.isErr()) {
          this.#log.error(
            { error: handlerResult.error.toSerializable(), event, subject: msg.subject },
            "Event handler failed",
          );
          msg.nak();
          continue;
        }

        msg.ack();
      }
    });
  }

  wait(): AsyncResult<void, BaseError> {
    return this.#tasks.wait();
  }

  // FIXME: If are validating things twice in most cases...
  template(
    subject: string,
    data: unknown,
    allowWildcards = false,
  ): Result<string, ValidationError> {
    // Find all template placeholders and check if values exist
    const placeholders = subject.match(/\{([^}]+)\}/g) || [];
    for (const placeholder of placeholders) {
      const key = placeholder.slice(1, -1); // Remove { and }
      const value = Pointer.Get(data, key);

      if ((value === undefined || value === null) && !allowWildcards) {
        return err(
          new ValidationError({
            errors: [
              {
                path: key,
                message: "Missing required data for subject template",
              },
            ],
            context: { key },
          }),
        );
      }
    }

    const result = subject.replace(/\{([^}]+)\}/g, (_, key) => {
      const value = Pointer.Get(data, key);
      if (allowWildcards && value === "*") {
        return "*";
      }
      if (allowWildcards && (value === undefined || value === null)) {
        return "*";
      }
      return this.#escapeSubjectToken(`${value}`);
    });

    return ok(result);
  }

  #escapeSubjectToken(token: string): string {
    const out = token.replace(
      NATS_SUBJECT_TOKEN_FORBIDDEN,
      (ch) => `~${ch.codePointAt(0)!.toString(16).toUpperCase()}~`,
    );

    // Protect stapRet with $ due to NATS internal use of it
    if (out.length === 0 || out.startsWith("$")) {
      return `_${out}`;
    }

    return out;
  }

  async #createProof(subject: string, payload: string): Promise<string> {
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadHash = await sha256(payloadBytes);
    const input = buildProofInput(this.auth.sessionKey, subject, payloadHash);
    const digest = await sha256(input);
    const sigBytes = await this.auth.sign(digest);
    return base64urlEncode(sigBytes);
  }

  async #requestJson(
    subject: string,
    body: JsonValue,
  ): Promise<Result<JsonValue, UnexpectedError>> {
    const payload = JSON.stringify(body);
    const proof = await this.#createProof(subject, payload);

    const headers = natsHeaders();
    headers.set("session-key", this.auth.sessionKey);
    headers.set("proof", proof);

    const response = await AsyncResult.try(() =>
      this.nats.request(subject, payload, {
        timeout: this.timeout,
        headers,
      })
    ).take();
    if (isErr(response)) {
      return response;
    }

    return safeJson(response);
  }

  async #watchJson(
    subject: string,
    body: JsonValue,
  ): Promise<Result<AsyncIterable<Result<JsonValue, UnexpectedError>>, UnexpectedError>> {
    const payload = JSON.stringify(body);
    const proof = await this.#createProof(subject, payload);

    const headers = natsHeaders();
    headers.set("session-key", this.auth.sessionKey);
    headers.set("proof", proof);

    const inbox = createInbox(`_INBOX.${this.auth.sessionKey.slice(0, 16)}`);
    const sub = this.nats.subscribe(inbox);

    try {
      this.nats.publish(subject, payload, {
        headers,
        reply: inbox,
      });
      await this.nats.flush();
    } catch (cause) {
      sub.unsubscribe();
      return err(new UnexpectedError({ cause }));
    }

    return ok((async function* () {
      try {
        for await (const msg of sub) {
          if (msg.headers?.get("status") === "error") {
            yield err(new UnexpectedError({ cause: new Error(msg.string()) }));
            continue;
          }

          yield safeJson(msg);
        }
      } finally {
        sub.unsubscribe();
      }
    })());
  }
}

type TrellisServerOpts<TA extends AnyTrellisAPI> =
  & Omit<TrellisOpts<TA>, "api">
  & {
    api: TA;
    version?: string;
  };

export class TrellisServer<TA extends AnyTrellisAPI = AnyTrellisAPI>
  extends Trellis<TA> {
  #version?: string;
  #log: Logger;
  #operations = new Map<string, RuntimeOperationRecord>();
  readonly operations: RuntimeOperationController;

  private constructor(
    name: string,
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: TrellisServerOpts<TA>,
  ) {
    super(name, nats, auth, opts);
    this.#version = opts?.version;
    this.#log = (opts?.log ?? logger).child({ lib: "trellis-server" });
    this.operations = {
      get: async (operationId) => {
        const runtime = await this.#resolveOperation(operationId);
        if (!runtime) {
          return err(new UnexpectedError({ cause: new Error(`Unknown operation '${operationId}'`) }));
        }
        return ok(runtime.snapshot);
      },
      started: async (operationId) => this.#applyOperationUpdate(operationId, "running", {
        event: { type: "started" },
      }),
      progress: async (operationId, progress) => this.#applyOperationUpdate(operationId, "running", {
        patch: { progress },
        event: { type: "progress" },
      }),
      complete: async (operationId, output) => this.#applyOperationUpdate(operationId, "completed", {
        patch: { output },
        event: { type: "completed" },
      }),
      fail: async (operationId, error) => this.#applyOperationUpdate(operationId, "failed", {
        patch: { error: { type: error.name, message: error.message } },
        event: { type: "failed" },
      }),
      cancel: async (operationId) => this.#applyOperationUpdate(operationId, "cancelled", {
        event: { type: "cancelled" },
      }),
    };
  }

  async #resolveOperation(operationId: string): Promise<RuntimeOperationRecord | null> {
    const existing = this.#operations.get(operationId);
    if (existing) {
      return existing;
    }

    const durable = await this.loadOperationRecord(operationId);
    if (!durable) {
      return null;
    }

    const runtime: RuntimeOperationRecord = {
      id: durable.snapshot.id,
      service: durable.snapshot.service,
      operation: durable.snapshot.operation,
      ownerSessionKey: durable.ownerSessionKey,
      snapshot: durable.snapshot,
      sequence: durable.sequence,
      terminal: durable.snapshot.state === "completed" ||
        durable.snapshot.state === "failed" ||
        durable.snapshot.state === "cancelled",
      watchers: new Set(),
      waiters: new Set(),
    };
    this.#operations.set(operationId, runtime);
    return runtime;
  }

  async #applyOperationUpdate(
    operationId: string,
    state: RuntimeOperationState,
    opts: {
      patch?: Partial<RuntimeOperationSnapshot>;
      event: { type: string };
    },
  ): Promise<Result<RuntimeOperationSnapshot, UnexpectedError>> {
    const runtime = await this.#resolveOperation(operationId);
    if (!runtime) {
      return err(new UnexpectedError({ cause: new Error(`Unknown operation '${operationId}'`) }));
    }

    if (runtime.terminal && state !== "cancelled") {
      return err(new UnexpectedError({ cause: new Error("operation already terminal") }));
    }

    runtime.sequence += 1;
    runtime.snapshot = buildRuntimeOperationSnapshot(runtime, state, opts.patch);
    runtime.terminal = state === "completed" || state === "failed" || state === "cancelled";

    await this.saveOperationRecord(runtime);

    const frame = {
      kind: "event",
      sequence: runtime.sequence,
      event: {
        type: opts.event.type,
        snapshot: runtime.snapshot,
      },
    };
    for (const reply of runtime.watchers) {
      await this.nats.publish(reply, JSON.stringify(frame));
    }

    if (runtime.terminal) {
      const terminalFrame = { kind: "snapshot", snapshot: runtime.snapshot };
      for (const reply of runtime.waiters) {
        await this.nats.publish(reply, JSON.stringify(terminalFrame));
      }
      runtime.waiters.clear();
    }

    return ok(runtime.snapshot);
  }

  /**
   * Creates an authenticated TrellisServer instance.
   *
   * Services connect to NATS using the session-key auth flow (see ADR):
   * - NATS `auth_token` (aka `token`) is a JSON string `{ v: 1, sessionKey, iat, sig }`
   * - `sig` signs SHA-256(`nats-connect:${iat}`) with the session key
   * - `inboxPrefix` MUST be `_INBOX.${sessionKey.slice(0, 16)}`
   *
   * @param name Unique name for this service
   * @param nats Existing NATS connection (already authenticated)
   * @param auth Service session-key credentials
   * @param opts Optional server options
   * @returns An authenticated TrellisServer instance
   */
  static create<TA extends AnyTrellisAPI = AnyTrellisAPI>(
    name: string,
    nats: NatsConnection,
    auth: TrellisAuth,
    opts: TrellisServerOpts<TA>,
  ): TrellisServer<TA> {
    return new TrellisServer<TA>(name, nats, auth, opts);
  }

  operation<O extends OperationsOf<TA>>(operation: O) {
    const ctx = this.api["operations"]?.[operation];
    if (!ctx) {
      throw new Error(
        `Unknown operation '${operation.toString()}'. Did you forget to include its API module?`,
      );
    }

    return {
      handle: async (handler: (context: unknown) => Promise<unknown>) => {
        const startSubject = ctx.subject;
        const controlSubject = `${ctx.subject}.control`;
        const now = () => new Date().toISOString();

        const publishFrame = async (reply: string, frame: unknown) => {
          await this.nats.publish(reply, JSON.stringify(frame));
        };

        const publishSnapshot = async (
          reply: string,
          snapshot: RuntimeOperationSnapshot,
        ) => {
          await publishFrame(reply, { kind: "snapshot", snapshot });
        };

        const publishEventToWatchers = async (
          runtime: RuntimeOperationRecord,
          event: unknown,
        ) => {
          const frame = { kind: "event", sequence: runtime.sequence, event };
          for (const reply of runtime.watchers) {
            await publishFrame(reply, frame);
          }
        };

        const flushWaiters = async (runtime: RuntimeOperationRecord) => {
          const frame = { kind: "snapshot", snapshot: runtime.snapshot };
          for (const reply of runtime.waiters) {
            await publishFrame(reply, frame);
          }
          runtime.waiters.clear();
        };

        const makeOperation = (runtime: RuntimeOperationRecord) => {
          const ensureActive = () => {
            if (runtime.terminal) {
              return err(new UnexpectedError({ cause: new Error("operation already terminal") }));
            }
            return null;
          };

          const transition = async (
            state: RuntimeOperationState,
            patch?: Partial<RuntimeOperationSnapshot>,
            event?: unknown,
          ) => {
            runtime.sequence += 1;
            runtime.snapshot = buildRuntimeOperationSnapshot(runtime, state, patch);
            await this.saveOperationRecord(runtime);
            if (event) {
              await publishEventToWatchers(runtime, event);
            }
            return ok(runtime.snapshot);
          };

          return {
            id: runtime.id,
            started: async () => {
              const active = ensureActive();
              if (active) return active;
              const snapshot = await transition("running", undefined, {
                type: "started",
                snapshot: buildRuntimeOperationSnapshot(runtime, "running", {
                  revision: runtime.snapshot.revision + 1,
                }),
              });
              return snapshot;
            },
            progress: async (value: unknown) => {
              const active = ensureActive();
              if (active) return active;
              const snapshot = await transition("running", { progress: value }, {
                type: "progress",
                snapshot: buildRuntimeOperationSnapshot(runtime, "running", {
                  revision: runtime.snapshot.revision + 1,
                  progress: value,
                }),
              });
              return snapshot;
            },
            complete: async (value: unknown) => {
              const active = ensureActive();
              if (active) return active;
              const snapshot = buildRuntimeOperationSnapshot(runtime, "completed", {
                output: value,
                completedAt: now(),
              });
              runtime.sequence += 1;
              runtime.snapshot = snapshot;
              runtime.terminal = true;
              await this.saveOperationRecord(runtime);
              await publishEventToWatchers(runtime, {
                type: "completed",
                snapshot,
              });
              await flushWaiters(runtime);
              return ok(snapshot);
            },
            fail: async (error: BaseError) => {
              const active = ensureActive();
              if (active) return active;
              const snapshot = buildRuntimeOperationSnapshot(runtime, "failed", {
                error: { type: error.name, message: error.message },
                completedAt: now(),
              });
              runtime.sequence += 1;
              runtime.snapshot = snapshot;
              runtime.terminal = true;
              await this.saveOperationRecord(runtime);
              await publishEventToWatchers(runtime, {
                type: "failed",
                snapshot,
              });
              await flushWaiters(runtime);
              return ok(snapshot);
            },
            cancel: async () => {
              const active = ensureActive();
              if (active) return active;
              const snapshot = buildRuntimeOperationSnapshot(runtime, "cancelled", {
                completedAt: now(),
              });
              runtime.sequence += 1;
              runtime.snapshot = snapshot;
              runtime.terminal = true;
              await this.saveOperationRecord(runtime);
              await publishEventToWatchers(runtime, {
                type: "cancelled",
                snapshot,
              });
              await flushWaiters(runtime);
              return ok(snapshot);
            },
            attach: async (job: { wait: () => Promise<Result<unknown, BaseError>> }) => {
              const waited = await job.wait();
              const waitedValue = waited.take();
              if (isErr(waitedValue)) {
                return waitedValue;
              }

              const finalRuntime = await this.#resolveOperation(runtime.id);
              if (!finalRuntime || !finalRuntime.terminal) {
                return err(
                  new UnexpectedError({
                    cause: new Error("attached job completed without terminal operation state"),
                  }),
                );
              }

              return ok(finalRuntime.snapshot);
            },
          };
        };

        const authenticate = async (msg: Msg, parseInput = true): Promise<
          Result<{
            input?: unknown;
            user: SessionUser;
            sessionKey: string;
            auth: { user: SessionUser; inboxPrefix: string };
          }, UnexpectedError | AuthError | ValidationError | RemoteError>
        > => {
          const jsonData = safeJson(msg).take();
          if (isErr(jsonData)) return jsonData;

          const parsedInput = parseInput
            ? parseSchema(ctx.input, jsonData).take()
            : jsonData;
          if (parseInput && isErr(parsedInput)) {
            return parsedInput;
          }

          const sessionKey = msg.headers?.get("session-key");
          const proof = msg.headers?.get("proof");
          if (!sessionKey) {
            return err(new AuthError({ reason: "missing_session_key" }));
          }
          if (!proof) {
            return err(new AuthError({ reason: "missing_proof" }));
          }

          const payloadBytes = msg.data ?? new Uint8Array();
          const payloadHash = await sha256(payloadBytes);
          const proofInput = buildProofInput(sessionKey, msg.subject, payloadHash);
          const digest = await sha256(proofInput);

          const verifyResult = await AsyncResult.try(async () => {
            const publicKeyRaw = base64urlDecode(sessionKey);
            const pub = await crypto.subtle.importKey(
              "raw",
              toArrayBuffer(publicKeyRaw),
              { name: "Ed25519" },
              true,
              ["verify"],
            );
            return crypto.subtle.verify(
              { name: "Ed25519" },
              pub,
              toArrayBuffer(base64urlDecode(proof)),
              toArrayBuffer(digest),
            );
          });
          const signatureOk = verifyResult.isOk() && (await verifyResult).take() === true;
          if (!signatureOk) {
            return err(new AuthError({ reason: "invalid_signature", context: { sessionKey } }));
          }

          const authDescriptor = this.api["rpc"]?.["Auth.ValidateRequest"];
          let auth;
          if (authDescriptor) {
            const authResult = await this.request("Auth.ValidateRequest", {
              sessionKey,
              proof,
              subject: msg.subject,
              payloadHash: base64urlEncode(payloadHash),
              capabilities: ctx.callerCapabilities,
            } as never);
            auth = authResult.take();
            if (isErr(auth)) {
              return auth;
            }
          } else {
            auth = {
              user: {
                id: sessionKey,
                origin: "trellis",
                active: true,
                name: "Operation Caller",
                email: "caller@trellis.internal",
                capabilities: ["service"],
              },
              inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
            };
          }

          if (
            typeof msg.reply !== "string" ||
            !msg.reply.startsWith(`${auth.inboxPrefix}.`)
          ) {
            return err(
              new AuthError({
                reason: "reply_subject_mismatch",
                context: { expected: auth.inboxPrefix, actual: msg.reply },
              }),
            );
          }

          return ok({
            input: parsedInput,
            user: auth.user,
            sessionKey,
            auth,
          });
        };

        this.#log.info({ operation: String(operation) }, `Mounting ${String(operation)} operation handler`);

        const startSub = this.nats.subscribe(startSubject);
        const controlSub = this.nats.subscribe(controlSubject);
        await this.nats.flush();

        void (async () => {
          for await (const msg of startSub) {
            const validated = await authenticate(msg, true);
            const value = validated.take();
            if (isErr(value)) {
              this.respondWithError(msg, value.error);
              continue;
            }

            const operationId = ulid();
            const createdAt = now();
            const runtime: RuntimeOperationRecord = {
              id: operationId,
              service: this.name,
              operation: String(operation),
              ownerSessionKey: value.sessionKey,
              snapshot: {
                id: operationId,
                service: this.name,
                operation: String(operation),
                revision: 1,
                state: "pending",
                createdAt,
                updatedAt: createdAt,
              },
              sequence: 0,
              terminal: false,
              watchers: new Set(),
              waiters: new Set(),
            };
            this.#operations.set(operationId, runtime);
            await this.saveOperationRecord(runtime);

            const accepted: RuntimeOperationAcceptedEnvelope = {
              kind: "accepted",
              ref: {
                id: operationId,
                service: this.name,
                operation: String(operation),
              },
              snapshot: runtime.snapshot,
            };

            msg.respond(JSON.stringify(accepted));

            void (async () => {
              const op = makeOperation(runtime);
              try {
                const handlerResult = await handler({
                  input: value.input,
                  op,
                  caller: value.user,
                });
                const handlerOutcome = handlerResult && typeof handlerResult.take === "function"
                  ? handlerResult.take()
                  : handlerResult;
                if (isErr(handlerOutcome)) {
                  await op.fail(handlerOutcome.error);
                  return;
                }

                if (isTerminalRuntimeOperationSnapshot(handlerOutcome)) {
                  runtime.sequence = handlerOutcome.revision;
                  runtime.snapshot = handlerOutcome;
                  runtime.terminal = true;
                  await this.saveOperationRecord(runtime);
                  return;
                }

                if (!runtime.terminal) {
                  await op.complete(handlerOutcome);
                }
              } catch (cause) {
                await op.fail(new UnexpectedError({ cause }));
              }
            })();
          }
        })();

        void (async () => {
          for await (const msg of controlSub) {
            const validated = await authenticate(msg, false);
            const value = validated.take();
            if (isErr(value)) {
              this.respondWithError(msg, value.error);
              continue;
            }

            const request = safeJson(msg).take();
            if (isErr(request)) {
              this.respondWithError(msg, request.error);
              continue;
            }

            if (
              !request ||
              typeof request !== "object" ||
              typeof (request as RuntimeOperationControlRequest).action !== "string" ||
              typeof (request as RuntimeOperationControlRequest).operationId !== "string"
            ) {
              this.respondWithError(
                msg,
                new UnexpectedError({
                  cause: new Error("Invalid operation control request"),
                }),
              );
              continue;
            }

            const control = request as RuntimeOperationControlRequest;
            const runtime = this.#operations.get(control.operationId);
            const durableRecord = runtime ? null : await this.loadOperationRecord(control.operationId);
            if (!runtime && !durableRecord) {
              this.respondWithError(
                msg,
                new UnexpectedError({
                  cause: new Error(`Unknown operation '${control.operationId}'`),
                }),
              );
              continue;
            }

            const snapshot = runtime?.snapshot ?? durableRecord!.snapshot;
            const ownerSessionKey = runtime?.ownerSessionKey ?? durableRecord!.ownerSessionKey;

            if (ownerSessionKey !== value.sessionKey) {
              this.respondWithError(
                msg,
                new AuthError({
                  reason: "operation_owner_mismatch",
                  context: { ownerSessionKey },
                }),
              );
              continue;
            }

            if (control.action === "watch") {
              if (msg.reply) {
                await publishSnapshot(msg.reply, snapshot);
                if (!runtime) {
                  continue;
                }
                runtime.watchers.add(msg.reply);
              }
              continue;
            }

            if (control.action === "wait") {
              if (snapshot.state === "completed" || snapshot.state === "failed" || snapshot.state === "cancelled") {
                msg.respond(JSON.stringify({ kind: "snapshot", snapshot }));
              } else if (runtime && msg.reply) {
                runtime.waiters.add(msg.reply);
              } else if (msg.reply) {
                this.respondWithError(
                  msg,
                  new UnexpectedError({
                    cause: new Error("operation is not running in this process"),
                  }),
                );
              } else {
                this.respondWithError(
                  msg,
                  new UnexpectedError({
                    cause: new Error("missing reply subject for wait request"),
                  }),
                );
              }
              continue;
            }

            if (control.action === "get") {
              msg.respond(JSON.stringify({ kind: "snapshot", snapshot }));
              continue;
            }

            if (control.action === "cancel") {
              if (!runtime) {
                msg.respond(JSON.stringify({ kind: "snapshot", snapshot }));
                continue;
              }
              runtime.snapshot = {
                ...runtime.snapshot,
                revision: runtime.snapshot.revision + 1,
                state: "cancelled",
                updatedAt: now(),
                completedAt: now(),
              };
              runtime.terminal = true;
              runtime.sequence += 1;
              await this.saveOperationRecord(runtime);
              await publishEventToWatchers(runtime, {
                type: "cancelled",
                snapshot: runtime.snapshot,
              });
              await flushWaiters(runtime);
              msg.respond(JSON.stringify({ kind: "snapshot", snapshot: runtime.snapshot }));
              continue;
            }

            this.respondWithError(
              msg,
              new UnexpectedError({
                cause: new Error(`Unknown operation control action '${control.action}'`),
              }),
            );
          }
        })();

        return Promise.resolve();
      },
    };
  }

  /**
   * Stops the server by clearing refresh timers and draining the NATS connection.
   * Draining allows in-flight messages to complete before closing the connection.
   * This method is idempotent and can be called multiple times safely.
   */
  async stop(): Promise<void> {
    // Only drain if the connection is not already closed
    if (!this.natsConnection.isClosed()) {
      await this.natsConnection.drain();
    }
  }
}
