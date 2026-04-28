import type { Msg, NatsConnection } from "@nats-io/nats-core";
import { Pointer } from "typebox/value";
import type { TrellisAPI } from "./contracts.ts";
import {
  AsyncResult,
  type BaseError,
  err,
  isErr,
  ok,
  Result,
} from "@qlever-llc/result";
import { ulid } from "ulid";

import { parseSchema } from "./codec.ts";
import {
  AuthError,
  TransferError,
  type TrellisErrorInstance,
  UnexpectedError,
  ValidationError,
} from "./errors/index.ts";
import { RemoteError } from "./errors/RemoteError.ts";
import type { LoggerLike } from "./globals.ts";
import { serverLogger } from "./server_logger.ts";
import {
  type AcceptedOperation,
  type AnyTrellisAPI,
  type AuthValidateRequestResponse,
  base64urlDecode,
  base64urlEncode,
  buildProofInput,
  buildRuntimeOperationSnapshot,
  type HandlerFn,
  isOperationDeferred,
  isResultLike,
  isTerminalRuntimeOperationSnapshot,
  type MethodsOf,
  type OperationHandlerContext,
  type OperationInputOf,
  type OperationOutputOf,
  type OperationProgressOf,
  type OperationRegistration,
  type OperationsOf,
  type OperationTransferContextOf,
  type OperationTransferHandle,
  type RuntimeOperationAcceptedEnvelope,
  type RuntimeOperationController,
  type RuntimeOperationControlRequest,
  type RuntimeOperationDesc,
  type RuntimeOperationRecord,
  type RuntimeOperationSnapshot,
  type RuntimeOperationState,
  safeJson,
  sha256,
  toArrayBuffer,
  Trellis,
  type TrellisAuth,
  type TrellisMode,
  type TrellisOpts,
} from "./trellis.ts";
import type { SendTransferGrant } from "./transfer.ts";

type TrellisServiceRuntimeOpts<TA extends AnyTrellisAPI> =
  & Omit<TrellisOpts<TA>, "api">
  & {
    api: TA;
    transferSupport?: RuntimeOperationTransferSupport;
    version?: string;
  };

export type TrellisServiceRuntimeFor<TA extends AnyTrellisAPI = TrellisAPI> =
  & Omit<TrellisServiceRuntime, "mount" | "operation">
  & {
    mount<M extends MethodsOf<TA>>(
      method: M,
      fn: HandlerFn<TA, M>,
    ): Promise<void>;
    operation<O extends OperationsOf<TA>>(
      operation: O,
    ): OperationRegistration<
      OperationInputOf<TA, O>,
      OperationProgressOf<TA, O>,
      OperationOutputOf<TA, O>,
      OperationTransferContextOf<TA, O>
    >;
  };

type RegisteredRuntimeOperationDesc = RuntimeOperationDesc & {
  callerCapabilities?: readonly string[];
};

type RuntimeOperationTransferSession = {
  grant: SendTransferGrant;
  transfer: OperationTransferHandle;
};

type RuntimeOperationTransferSupport = {
  openOperationTransfer(args: {
    sessionKey: string;
    store: string;
    key: string;
    expiresInMs: number;
    maxBytes?: number;
    contentType?: string;
    metadata?: Record<string, string>;
  }): AsyncResult<RuntimeOperationTransferSession, TransferError>;
};

function asStringPointerValue(
  operation: string,
  input: unknown,
  pointer: `/${string}`,
  field: string,
): Result<string, TransferError> {
  const value = Pointer.Get(input as Record<string, unknown>, pointer);
  if (typeof value !== "string" || value.length === 0) {
    return err(
      new TransferError({
        operation: "transfer",
        context: { reason: "invalid_input", operation, field, pointer },
      }),
    );
  }
  return ok(value);
}

function asOptionalStringPointerValue(
  input: unknown,
  pointer?: `/${string}`,
): Result<string | undefined, TransferError> {
  if (!pointer) {
    return ok(undefined);
  }
  const value = Pointer.Get(input as Record<string, unknown>, pointer);
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || value.length === 0) {
    return err(
      new TransferError({
        operation: "transfer",
        context: { reason: "invalid_input", field: pointer, pointer },
      }),
    );
  }
  return ok(value);
}

function asOptionalStringRecordPointerValue(
  input: unknown,
  pointer?: `/${string}`,
): Result<Record<string, string> | undefined, TransferError> {
  if (!pointer) {
    return ok(undefined);
  }
  const value = Pointer.Get(input as Record<string, unknown>, pointer);
  if (value === undefined) {
    return ok(undefined);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return err(
      new TransferError({
        operation: "transfer",
        context: { reason: "invalid_input", field: pointer, pointer },
      }),
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(([key, item]) => key.length === 0 || typeof item !== "string")
  ) {
    return err(
      new TransferError({
        operation: "transfer",
        context: { reason: "invalid_input", field: pointer, pointer },
      }),
    );
  }

  return ok(Object.fromEntries(entries) as Record<string, string>);
}

export class TrellisServiceRuntime extends Trellis<TrellisAPI, TrellisMode> {
  #version?: string;
  #log: LoggerLike;
  #operations = new Map<string, RuntimeOperationRecord>();
  #mountedOperationControls = new Set<string>();
  #stopPromise?: Promise<void>;
  #transferSupport?: RuntimeOperationTransferSupport;
  readonly operations: RuntimeOperationController;

  private constructor(
    name: string,
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: TrellisServiceRuntimeOpts<TrellisAPI>,
  ) {
    super(name, nats, auth, { ...opts, log: opts?.log ?? serverLogger });
    this.#version = opts?.version;
    this.#log = (opts?.log ?? serverLogger).child({ lib: "trellis-server" });
    this.#transferSupport = opts?.transferSupport;
    this.operations = {
      get: (operationId) =>
        AsyncResult.from((async () => {
          const runtime = await this.#resolveOperation(operationId);
          if (!runtime) {
            return err(
              new UnexpectedError({
                cause: new Error(`Unknown operation '${operationId}'`),
              }),
            );
          }
          return ok(runtime.snapshot);
        })()),
      started: (operationId) =>
        this.#applyOperationUpdate(operationId, "running", {
          event: { type: "started" },
        }),
      progress: (operationId, progress) =>
        this.#applyOperationUpdate(operationId, "running", {
          patch: { progress },
          event: { type: "progress", progress },
        }),
      complete: (operationId, output) =>
        this.#applyOperationUpdate(operationId, "completed", {
          patch: { output },
          event: { type: "completed" },
        }),
      fail: (operationId, error) =>
        this.#applyOperationUpdate(operationId, "failed", {
          patch: { error: { type: error.name, message: error.message } },
          event: { type: "failed" },
        }),
      cancel: (operationId) =>
        this.#applyOperationUpdate(operationId, "cancelled", {
          event: { type: "cancelled" },
        }),
    };
  }

  async #resolveOperation(
    operationId: string,
  ): Promise<RuntimeOperationRecord | null> {
    const existing = this.#operations.get(operationId);
    if (existing) return existing;

    const durable = await this.loadOperationRecord(operationId);
    if (!durable) return null;

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

  #applyOperationUpdate(
    operationId: string,
    state: RuntimeOperationState,
    opts: {
      patch?: Partial<RuntimeOperationSnapshot>;
      event: Record<string, unknown> & { type: string };
    },
  ): AsyncResult<RuntimeOperationSnapshot, UnexpectedError> {
    return AsyncResult.from((async () => {
      const runtime = await this.#resolveOperation(operationId);
      if (!runtime) {
        return err(
          new UnexpectedError({
            cause: new Error(`Unknown operation '${operationId}'`),
          }),
        );
      }

      if (runtime.terminal && state !== "cancelled") {
        return err(
          new UnexpectedError({
            cause: new Error("operation already terminal"),
          }),
        );
      }

      runtime.sequence += 1;
      runtime.snapshot = buildRuntimeOperationSnapshot(
        runtime,
        state,
        opts.patch,
      );
      runtime.terminal = state === "completed" || state === "failed" ||
        state === "cancelled";

      await this.saveOperationRecord(runtime);

      const frame = {
        kind: "event",
        sequence: runtime.sequence,
        event: {
          snapshot: runtime.snapshot,
          ...opts.event,
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
    })());
  }

  #makeAcceptedOperation(
    runtime: RuntimeOperationRecord,
  ): AcceptedOperation<unknown, unknown> {
    return {
      id: runtime.id,
      ref: {
        id: runtime.id,
        service: runtime.service,
        operation: runtime.operation,
      },
      snapshot: runtime.snapshot,
      started: () => this.operations.started(runtime.id),
      progress: (value: unknown) => this.operations.progress(runtime.id, value),
      complete: (value: unknown) => this.operations.complete(runtime.id, value),
      fail: (error: BaseError) => this.operations.fail(runtime.id, error),
      cancel: () => this.operations.cancel(runtime.id),
      attach: (job: { wait(): AsyncResult<unknown, BaseError> }) =>
        AsyncResult.from((async () => {
          const waited = await job.wait();
          const waitedValue = waited.take();
          if (isErr(waitedValue)) {
            return err(new UnexpectedError({ cause: waitedValue.error }));
          }

          const finalRuntime = await this.#resolveOperation(runtime.id);
          if (!finalRuntime || !finalRuntime.terminal) {
            return err(
              new UnexpectedError({
                cause: new Error(
                  "attached job completed without terminal operation state",
                ),
              }),
            );
          }

          return ok(finalRuntime.snapshot);
        })()),
      defer: () => ({ kind: "deferred" as const }),
    };
  }

  async #acceptOperation(
    operation: string,
    sessionKey: string,
  ): Promise<Result<AcceptedOperation<unknown, unknown>, UnexpectedError>> {
    const createdAt = new Date().toISOString();
    const operationId = ulid();
    const runtime: RuntimeOperationRecord = {
      id: operationId,
      service: this.name,
      operation,
      ownerSessionKey: sessionKey,
      snapshot: {
        id: operationId,
        service: this.name,
        operation,
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
    return ok(this.#makeAcceptedOperation(runtime));
  }

  async #authenticateOperationMessage(
    msg: Msg,
    ctx: RegisteredRuntimeOperationDesc,
    parseInput: boolean,
  ): Promise<
    Result<{
      input: unknown;
      caller: AuthValidateRequestResponse["caller"];
      sessionKey: string;
      auth: AuthValidateRequestResponse;
    }, UnexpectedError | AuthError | ValidationError | RemoteError>
  > {
    const jsonData = safeJson(msg).take();
    if (isErr(jsonData)) return jsonData;

    let parsedInput: unknown;
    if (parseInput) {
      const parsedInputResult = parseSchema(
        ctx.input as Parameters<typeof parseSchema>[0],
        jsonData,
      ).take();
      if (isErr(parsedInputResult)) {
        return err(
          parsedInputResult.error as ValidationError | UnexpectedError,
        );
      }
      parsedInput = parsedInputResult;
    } else {
      parsedInput = jsonData;
    }

    const sessionKey = msg.headers?.get("session-key");
    const proof = msg.headers?.get("proof");
    if (!sessionKey) {
      return err(new AuthError({ reason: "missing_session_key" }));
    }
    if (!proof) return err(new AuthError({ reason: "missing_proof" }));

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
    const signatureOk = verifyResult.isOk() &&
      verifyResult.take() === true;
    if (!signatureOk) {
      return err(
        new AuthError({
          reason: "invalid_signature",
          context: { sessionKey },
        }),
      );
    }

    const auth = await this.requestAuthValidate({
      sessionKey,
      proof,
      subject: msg.subject,
      payloadHash: base64urlEncode(payloadHash),
      capabilities: ctx.callerCapabilities
        ? [...ctx.callerCapabilities]
        : undefined,
    }).take();
    if (isErr(auth)) {
      return err(
        auth.error as
          | RemoteError
          | ValidationError
          | UnexpectedError
          | AuthError,
      );
    }

    if (!auth.allowed) {
      return err(
        new AuthError({
          reason: "insufficient_permissions",
          context: {
            requiredCapabilities: ctx.callerCapabilities,
            userCapabilities: auth.caller.capabilities,
          },
        }),
      );
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
      caller: auth.caller,
      sessionKey,
      auth,
    });
  }

  #ensureOperationControlLoop(
    operation: string,
    ctx: RegisteredRuntimeOperationDesc,
  ): void {
    const controlSubject = `${ctx.subject}.control`;
    if (this.#mountedOperationControls.has(controlSubject)) {
      return;
    }
    this.#mountedOperationControls.add(controlSubject);

    const publishFrame = async (reply: string, frame: unknown) => {
      await this.nats.publish(reply, JSON.stringify(frame));
    };

    const publishSnapshot = async (
      reply: string,
      snapshot: RuntimeOperationSnapshot,
    ) => {
      await publishFrame(reply, { kind: "snapshot", snapshot });
    };

    const controlSub = this.nats.subscribe(controlSubject);
    void (async () => {
      for await (const msg of controlSub) {
        const validated = await this.#authenticateOperationMessage(
          msg,
          ctx,
          false,
        );
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
          typeof (request as RuntimeOperationControlRequest).action !==
            "string" ||
          typeof (request as RuntimeOperationControlRequest).operationId !==
            "string"
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
        const durableRecord = runtime
          ? null
          : await this.loadOperationRecord(control.operationId);
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
        const ownerSessionKey = runtime?.ownerSessionKey ??
          durableRecord!.ownerSessionKey;

        if (ownerSessionKey !== value.sessionKey) {
          this.respondWithError(
            msg,
            new AuthError({
              reason: "forbidden",
              context: { ownerSessionKey },
            }),
          );
          continue;
        }

        if (control.action === "watch") {
          if (msg.reply) {
            await publishSnapshot(msg.reply, snapshot);
            if (!runtime) continue;
            runtime.watchers.add(msg.reply);
          }
          continue;
        }

        if (control.action === "wait") {
          if (
            snapshot.state === "completed" || snapshot.state === "failed" ||
            snapshot.state === "cancelled"
          ) {
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
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
          runtime.terminal = true;
          runtime.sequence += 1;
          await this.saveOperationRecord(runtime);
          const frame = {
            kind: "event",
            sequence: runtime.sequence,
            event: {
              type: "cancelled",
              snapshot: runtime.snapshot,
            },
          };
          for (const reply of runtime.watchers) {
            await this.nats.publish(reply, JSON.stringify(frame));
          }
          for (const reply of runtime.waiters) {
            await this.nats.publish(
              reply,
              JSON.stringify({ kind: "snapshot", snapshot: runtime.snapshot }),
            );
          }
          runtime.waiters.clear();
          msg.respond(
            JSON.stringify({ kind: "snapshot", snapshot: runtime.snapshot }),
          );
          continue;
        }

        this.respondWithError(
          msg,
          new UnexpectedError({
            cause: new Error(
              `Unknown operation control action '${control.action}' for '${operation}'`,
            ),
          }),
        );
      }
    })();
  }

  mountRuntime(
    method: string,
    fn: Parameters<Trellis<TrellisAPI, TrellisMode>["mount"]>[1],
  ): Promise<void> {
    return super.mount(method, fn);
  }

  static create<TA extends AnyTrellisAPI>(
    name: string,
    nats: NatsConnection,
    auth: TrellisAuth,
    opts: TrellisServiceRuntimeOpts<TA>,
  ): TrellisServiceRuntimeFor<TA> {
    const runtime = new TrellisServiceRuntime(
      name,
      nats,
      auth,
      opts as TrellisServiceRuntimeOpts<TrellisAPI>,
    );
    return runtime as TrellisServiceRuntime & TrellisServiceRuntimeFor<TA>;
  }

  override operation(
    operation: string,
  ): OperationRegistration<unknown, unknown, unknown> {
    const ctx = this.api["operations"]
      ?.[operation as keyof typeof this.api.operations] as
        | RegisteredRuntimeOperationDesc
        | undefined;
    if (!ctx) {
      throw new Error(
        `Unknown operation '${operation.toString()}'. Did you forget to include its API module?`,
      );
    }

    return {
      accept: ({ sessionKey }) => {
        this.#ensureOperationControlLoop(String(operation), ctx);
        if (ctx.transfer) {
          return AsyncResult.err(
            new UnexpectedError({
              cause: new Error(
                `Operation '${
                  String(operation)
                }' uses transfer-capable start semantics and cannot be accepted manually`,
              ),
            }),
          );
        }
        return AsyncResult.from(
          this.#acceptOperation(String(operation), sessionKey),
        );
      },
      handle: async (
        handler: (
          context: OperationHandlerContext<
            unknown,
            unknown,
            unknown,
            OperationTransferHandle | undefined
          >,
        ) => unknown | Promise<unknown>,
      ) => {
        const startSubject = ctx.subject;
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
              return err(
                new UnexpectedError({
                  cause: new Error("operation already terminal"),
                }),
              );
            }
            return null;
          };

          const transition = async (
            state: RuntimeOperationState,
            patch?: Partial<RuntimeOperationSnapshot>,
            event?: unknown,
          ) => {
            runtime.sequence += 1;
            runtime.snapshot = buildRuntimeOperationSnapshot(
              runtime,
              state,
              patch,
            );
            await this.saveOperationRecord(runtime);
            if (event) {
              await publishEventToWatchers(runtime, event);
            }
            return ok(runtime.snapshot);
          };

          return {
            id: runtime.id,
            started: () =>
              AsyncResult.from((async () => {
                const active = ensureActive();
                if (active) return active;
                return transition("running", undefined, {
                  type: "started",
                  snapshot: buildRuntimeOperationSnapshot(runtime, "running", {
                    revision: runtime.snapshot.revision + 1,
                  }),
                });
              })()),
            progress: (value: unknown) =>
              AsyncResult.from((async () => {
                const active = ensureActive();
                if (active) return active;
                return transition("running", { progress: value }, {
                  type: "progress",
                  snapshot: buildRuntimeOperationSnapshot(runtime, "running", {
                    revision: runtime.snapshot.revision + 1,
                    progress: value,
                  }),
                });
              })()),
            complete: (value: unknown) =>
              AsyncResult.from((async () => {
                const active = ensureActive();
                if (active) return active;
                const snapshot = buildRuntimeOperationSnapshot(
                  runtime,
                  "completed",
                  {
                    output: value,
                    completedAt: now(),
                  },
                );
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
              })()),
            fail: (error: BaseError) =>
              AsyncResult.from((async () => {
                const active = ensureActive();
                if (active) return active;
                const snapshot = buildRuntimeOperationSnapshot(
                  runtime,
                  "failed",
                  {
                    error: { type: error.name, message: error.message },
                    completedAt: now(),
                  },
                );
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
              })()),
            cancel: () =>
              AsyncResult.from((async () => {
                const active = ensureActive();
                if (active) return active;
                const snapshot = buildRuntimeOperationSnapshot(
                  runtime,
                  "cancelled",
                  {
                    completedAt: now(),
                  },
                );
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
              })()),
            attach: (job: { wait: () => AsyncResult<unknown, BaseError> }) =>
              AsyncResult.from((async () => {
                const waited = await job.wait();
                const waitedValue = waited.take();
                if (isErr(waitedValue)) {
                  return err(new UnexpectedError({ cause: waitedValue.error }));
                }

                const finalRuntime = await this.#resolveOperation(runtime.id);
                if (!finalRuntime || !finalRuntime.terminal) {
                  return err(
                    new UnexpectedError({
                      cause: new Error(
                        "attached job completed without terminal operation state",
                      ),
                    }),
                  );
                }

                return ok(finalRuntime.snapshot);
              })()),
            defer: () => ({ kind: "deferred" as const }),
          };
        };

        const authenticate = async (msg: Msg, parseInput = true): Promise<
          Result<{
            input: unknown;
            caller: AuthValidateRequestResponse["caller"];
            sessionKey: string;
            auth: AuthValidateRequestResponse;
          }, UnexpectedError | AuthError | ValidationError | RemoteError>
        > => {
          const jsonData = safeJson(msg).take();
          if (isErr(jsonData)) return jsonData;

          let parsedInput: unknown;
          if (parseInput) {
            const parsedInputResult = parseSchema(
              ctx.input as Parameters<typeof parseSchema>[0],
              jsonData,
            ).take();
            if (isErr(parsedInputResult)) {
              return err(
                parsedInputResult.error as ValidationError | UnexpectedError,
              );
            }
            parsedInput = parsedInputResult;
          } else {
            parsedInput = jsonData;
          }

          const sessionKey = msg.headers?.get("session-key");
          const proof = msg.headers?.get("proof");
          if (!sessionKey) {
            return err(new AuthError({ reason: "missing_session_key" }));
          }
          if (!proof) return err(new AuthError({ reason: "missing_proof" }));

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
            verifyResult.take() === true;
          if (!signatureOk) {
            return err(
              new AuthError({
                reason: "invalid_signature",
                context: { sessionKey },
              }),
            );
          }

          const authResult = await this.requestAuthValidate({
            sessionKey,
            proof,
            subject: msg.subject,
            payloadHash: base64urlEncode(payloadHash),
            capabilities: ctx.callerCapabilities
              ? [...ctx.callerCapabilities]
              : undefined,
          });
          const auth = authResult.take();
          if (isErr(auth)) {
            return err(
              auth.error as
                | RemoteError
                | ValidationError
                | UnexpectedError
                | AuthError,
            );
          }

          if (!auth.allowed) {
            return err(
              new AuthError({
                reason: "insufficient_permissions",
                context: {
                  requiredCapabilities: ctx.callerCapabilities,
                  userCapabilities: auth.caller.capabilities,
                },
              }),
            );
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
            caller: auth.caller,
            sessionKey,
            auth,
          });
        };

        this.#log.info(
          { operation: String(operation) },
          `Mounting ${String(operation)} operation handler`,
        );

        this.#ensureOperationControlLoop(String(operation), ctx);
        const startSub = this.nats.subscribe(startSubject);
        await this.nats.flush();

        void (async () => {
          for await (const msg of startSub) {
            const validated = await authenticate(msg, true);
            const value = validated.take();
            if (isErr(value)) {
              this.respondWithError(msg, value.error);
              continue;
            }

            let transferSession: RuntimeOperationTransferSession | undefined;
            if (ctx.transfer) {
              if (!this.#transferSupport) {
                this.respondWithError(
                  msg,
                  new UnexpectedError({
                    cause: new Error(
                      `Operation '${
                        String(operation)
                      }' declared transfer support but no runtime transfer support is configured`,
                    ),
                  }),
                );
                continue;
              }

              const key = asStringPointerValue(
                String(operation),
                value.input,
                ctx.transfer.key,
                "key",
              ).take();
              if (isErr(key)) {
                this.respondWithError(msg, key.error);
                continue;
              }

              const contentType = asOptionalStringPointerValue(
                value.input,
                ctx.transfer.contentType,
              ).take();
              if (isErr(contentType)) {
                this.respondWithError(msg, contentType.error);
                continue;
              }

              const metadata = asOptionalStringRecordPointerValue(
                value.input,
                ctx.transfer.metadata,
              ).take();
              if (isErr(metadata)) {
                this.respondWithError(msg, metadata.error);
                continue;
              }

              const openedTransferValue = await this.#transferSupport
                .openOperationTransfer({
                  sessionKey: value.sessionKey,
                  store: ctx.transfer.store,
                  key,
                  expiresInMs: ctx.transfer.expiresInMs ?? 60_000,
                  ...(ctx.transfer.maxBytes !== undefined
                    ? { maxBytes: ctx.transfer.maxBytes }
                    : {}),
                  ...(contentType !== undefined ? { contentType } : {}),
                  ...(metadata !== undefined ? { metadata } : {}),
                }).take();
              if (isErr(openedTransferValue)) {
                this.respondWithError(msg, openedTransferValue.error);
                continue;
              }
              transferSession = openedTransferValue;
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

            if (transferSession) {
              void (async () => {
                for await (
                  const progress of transferSession.transfer.updates()
                ) {
                  runtime.sequence += 1;
                  runtime.snapshot = buildRuntimeOperationSnapshot(
                    runtime,
                    "running",
                    { transfer: progress },
                  );
                  await this.saveOperationRecord(runtime);
                  await publishEventToWatchers(runtime, {
                    type: "transfer",
                    transfer: progress,
                    snapshot: runtime.snapshot,
                  });
                }
              })();
            }

            const accepted: RuntimeOperationAcceptedEnvelope = {
              kind: "accepted",
              ref: {
                id: operationId,
                service: this.name,
                operation: String(operation),
              },
              snapshot: runtime.snapshot,
              ...(transferSession ? { transfer: transferSession.grant } : {}),
            };
            msg.respond(JSON.stringify(accepted));

            void (async () => {
              const op = makeOperation(runtime);
              try {
                const handlerResult: unknown = await handler(
                  transferSession
                    ? {
                      input: value.input,
                      op,
                      caller: value.caller,
                      transfer: transferSession.transfer,
                    }
                    : {
                      input: value.input,
                      op,
                      caller: value.caller,
                    },
                );
                const handlerOutcome = isResultLike(handlerResult)
                  ? handlerResult.take()
                  : handlerResult;
                if (isErr(handlerOutcome)) {
                  await op.fail(handlerOutcome.error);
                  return;
                }

                if (isOperationDeferred(handlerOutcome)) {
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

        return Promise.resolve();
      },
    };
  }

  async stop(): Promise<void> {
    this.#stopPromise ??= (async () => {
      if (this.natsConnection.isClosed()) {
        return;
      }

      try {
        await this.natsConnection.drain();
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          cause.name !== "DrainingConnectionError"
        ) {
          throw cause;
        }

        await this.natsConnection.closed().catch(() => undefined);
      }
    })();

    await this.#stopPromise;
  }
}
