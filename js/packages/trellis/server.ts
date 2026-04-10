import type { Msg, NatsConnection } from "@nats-io/nats-core";
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
  type TrellisErrorInstance,
  UnexpectedError,
  ValidationError,
} from "./errors/index.ts";
import { RemoteError } from "./errors/RemoteError.ts";
import type { LoggerLike } from "./globals.ts";
import { serverLogger } from "./server_logger.ts";
import {
  type AnyTrellisAPI,
  type AuthValidateRequestResponse,
  base64urlDecode,
  base64urlEncode,
  buildProofInput,
  buildRuntimeOperationSnapshot,
  type HandlerFn,
  isResultLike,
  isTerminalRuntimeOperationSnapshot,
  type MethodsOf,
  type OperationHandlerContext,
  type OperationInputOf,
  type OperationOutputOf,
  type OperationProgressOf,
  type OperationRegistration,
  type OperationsOf,
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

type TrellisServerOpts<TA extends AnyTrellisAPI> =
  & Omit<TrellisOpts<TA>, "api">
  & {
    api: TA;
    version?: string;
  };

export type TrellisServerFor<TA extends AnyTrellisAPI = TrellisAPI> =
  & TrellisServer
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
      OperationOutputOf<TA, O>
    >;
  };

type RegisteredRuntimeOperationDesc = RuntimeOperationDesc & {
  callerCapabilities?: string[];
};

export class TrellisServer extends Trellis<TrellisAPI, TrellisMode> {
  #version?: string;
  #log: LoggerLike;
  #operations = new Map<string, RuntimeOperationRecord>();
  readonly operations: RuntimeOperationController;

  private constructor(
    name: string,
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: TrellisServerOpts<TrellisAPI>,
  ) {
    super(name, nats, auth, { ...opts, log: opts?.log ?? serverLogger });
    this.#version = opts?.version;
    this.#log = (opts?.log ?? serverLogger).child({ lib: "trellis-server" });
    this.operations = {
      get: async (operationId) => {
        const runtime = await this.#resolveOperation(operationId);
        if (!runtime) {
          return err(
            new UnexpectedError({
              cause: new Error(`Unknown operation '${operationId}'`),
            }),
          );
        }
        return ok(runtime.snapshot);
      },
      started: async (operationId) =>
        this.#applyOperationUpdate(operationId, "running", {
          event: { type: "started" },
        }),
      progress: async (operationId, progress) =>
        this.#applyOperationUpdate(operationId, "running", {
          patch: { progress },
          event: { type: "progress" },
        }),
      complete: async (operationId, output) =>
        this.#applyOperationUpdate(operationId, "completed", {
          patch: { output },
          event: { type: "completed" },
        }),
      fail: async (operationId, error) =>
        this.#applyOperationUpdate(operationId, "failed", {
          patch: { error: { type: error.name, message: error.message } },
          event: { type: "failed" },
        }),
      cancel: async (operationId) =>
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
      return err(
        new UnexpectedError({
          cause: new Error(`Unknown operation '${operationId}'`),
        }),
      );
    }

    if (runtime.terminal && state !== "cancelled") {
      return err(
        new UnexpectedError({ cause: new Error("operation already terminal") }),
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

  static create<TA extends AnyTrellisAPI>(
    name: string,
    nats: NatsConnection,
    auth: TrellisAuth,
    opts: TrellisServerOpts<TA>,
  ): TrellisServerFor<TA> {
    return new TrellisServer(
      name,
      nats,
      auth,
      opts as TrellisServerOpts<TrellisAPI>,
    ) as TrellisServerFor<TA>;
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
      handle: async (
        handler: (
          context: OperationHandlerContext<unknown, unknown, unknown>,
        ) => unknown | Promise<unknown>,
      ) => {
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
            started: async () => {
              const active = ensureActive();
              if (active) return active;
              return transition("running", undefined, {
                type: "started",
                snapshot: buildRuntimeOperationSnapshot(runtime, "running", {
                  revision: runtime.snapshot.revision + 1,
                }),
              });
            },
            progress: async (value: unknown) => {
              const active = ensureActive();
              if (active) return active;
              return transition("running", { progress: value }, {
                type: "progress",
                snapshot: buildRuntimeOperationSnapshot(runtime, "running", {
                  revision: runtime.snapshot.revision + 1,
                  progress: value,
                }),
              });
            },
            complete: async (value: unknown) => {
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
            },
            fail: async (error: BaseError) => {
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
            },
            cancel: async () => {
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
            },
            attach: async (
              job: { wait: () => Promise<Result<unknown, BaseError>> },
            ) => {
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
            },
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
            (await verifyResult).take() === true;
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
            capabilities: ctx.callerCapabilities,
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
                const handlerResult: unknown = await handler({
                  input: value.input,
                  op,
                  caller: value.caller,
                });
                const handlerOutcome = isResultLike(handlerResult)
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
                  cause: new Error(
                    `Unknown operation '${control.operationId}'`,
                  ),
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
                    cause: new Error(
                      "operation is not running in this process",
                    ),
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
              msg.respond(
                JSON.stringify({
                  kind: "snapshot",
                  snapshot: runtime.snapshot,
                }),
              );
              continue;
            }

            this.respondWithError(
              msg,
              new UnexpectedError({
                cause: new Error(
                  `Unknown operation control action '${control.action}'`,
                ),
              }),
            );
          }
        })();

        return Promise.resolve();
      },
    };
  }

  async stop(): Promise<void> {
    if (!this.natsConnection.isClosed()) {
      await this.natsConnection.drain();
    }
  }
}
