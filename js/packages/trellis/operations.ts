import type {
  InferSchemaType,
} from "./contracts.ts";
import { AsyncResult, err, isErr, ok, type Result } from "@qlever-llc/result";

import type { JsonValue } from "./codec.ts";
import { TransferError, UnexpectedError } from "./errors/index.ts";
import type {
  FileInfo,
  TransferBody,
  UploadTransferGrant,
} from "./transfer.ts";

export type OperationState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type OperationRefData = {
  id: string;
  service: string;
  operation: string;
};

export type OperationSnapshot<TProgress = unknown, TOutput = unknown> = {
  id: string;
  service: string;
  operation: string;
  revision: number;
  state: OperationState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress?: TProgress;
  transfer?: OperationTransferProgress;
  output?: TOutput;
  error?: {
    type: string;
    message: string;
  };
};

export type OperationTransferProgress = {
  chunkIndex: number;
  chunkBytes: number;
  transferredBytes: number;
};

export type TerminalOperation<TProgress = unknown, TOutput = unknown> =
  OperationSnapshot<TProgress, TOutput> & {
    state: "completed" | "failed" | "cancelled";
  };

export type CompletedTransfer<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> = {
  transferred: FileInfo;
  terminal: TerminalOperation<TProgress, TOutput>;
};

export type StartedTransfer<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> = {
  operation: OperationRef<
    TDesc,
    TProgress,
    TOutput
  >;
  wait(): AsyncResult<
    CompletedTransfer<TDesc, TProgress, TOutput>,
    UnexpectedError | TransferError
  >;
};

type OperationRefCanCancel<TDesc extends OperationShape> = "cancel" extends keyof TDesc
  ? TDesc extends { cancel: false | undefined } ? false
    : true
  : false;

export type OperationRef<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> = {
  id: string;
  service: string;
  operation: string;
  get(): AsyncResult<OperationSnapshot<TProgress, TOutput>, UnexpectedError>;
  wait(): AsyncResult<TerminalOperation<TProgress, TOutput>, UnexpectedError>;
  watch(): AsyncResult<AsyncIterable<OperationEvent<TProgress, TOutput>>, UnexpectedError>;
} & (OperationRefCanCancel<TDesc> extends true
  ? {
      cancel(): AsyncResult<OperationSnapshot<TProgress, TOutput>, UnexpectedError>;
    }
  : {});

export type AcceptedOperationEvent<TProgress = unknown, TOutput = unknown> = {
  type: "accepted";
  snapshot: OperationSnapshot<TProgress, TOutput>;
};

export type StartedOperationEvent<TProgress = unknown, TOutput = unknown> = {
  type: "started";
  snapshot: OperationSnapshot<TProgress, TOutput>;
};

export type TransferOperationSnapshot<TProgress = unknown, TOutput = unknown> =
  & OperationSnapshot<TProgress, TOutput>
  & { transfer: OperationTransferProgress };

export type TransferOperationEvent<TProgress = unknown, TOutput = unknown> = {
  type: "transfer";
  snapshot: TransferOperationSnapshot<TProgress, TOutput>;
  transfer: OperationTransferProgress;
};

export type ProgressOperationSnapshot<TProgress = unknown, TOutput = unknown> =
  & OperationSnapshot<TProgress, TOutput>
  & { progress: TProgress };

export type ProgressOperationEvent<TProgress = unknown, TOutput = unknown> = {
  type: "progress";
  snapshot: ProgressOperationSnapshot<TProgress, TOutput>;
  progress: TProgress;
};

export type CompletedOperationEvent<TProgress = unknown, TOutput = unknown> = {
  type: "completed";
  snapshot: TerminalOperation<TProgress, TOutput>;
};

export type FailedOperationEvent<TProgress = unknown, TOutput = unknown> = {
  type: "failed";
  snapshot: TerminalOperation<TProgress, TOutput>;
};

export type CancelledOperationEvent<TProgress = unknown, TOutput = unknown> = {
  type: "cancelled";
  snapshot: TerminalOperation<TProgress, TOutput>;
};

export type OperationEvent<TProgress = unknown, TOutput = unknown> =
  | AcceptedOperationEvent<TProgress, TOutput>
  | StartedOperationEvent<TProgress, TOutput>
  | TransferOperationEvent<TProgress, TOutput>
  | ProgressOperationEvent<TProgress, TOutput>
  | CompletedOperationEvent<TProgress, TOutput>
  | FailedOperationEvent<TProgress, TOutput>
  | CancelledOperationEvent<TProgress, TOutput>;

export type OperationObserverCallbacks<TProgress = unknown, TOutput = unknown> = {
  onAccepted?: (
    event: AcceptedOperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
  onStarted?: (
    event: StartedOperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
  onTransfer?: (
    event: TransferOperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
  onProgress?: (
    event: ProgressOperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
  onCompleted?: (
    event: CompletedOperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
  onFailed?: (
    event: FailedOperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
  onCancelled?: (
    event: CancelledOperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
  onEvent?: (
    event: OperationEvent<TProgress, TOutput>,
  ) => void | Promise<void>;
};

interface OperationObserverBuilderBase<
  TBuilder,
  TProgress = unknown,
  TOutput = unknown,
> {
  onAccepted(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onAccepted"]>,
  ): TBuilder;
  onStarted(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onStarted"]>,
  ): TBuilder;
  onProgress(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onProgress"]>,
  ): TBuilder;
  onCompleted(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onCompleted"]>,
  ): TBuilder;
  onFailed(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onFailed"]>,
  ): TBuilder;
  onCancelled(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onCancelled"]>,
  ): TBuilder;
  onEvent(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onEvent"]>,
  ): TBuilder;
}

interface OperationInputBuilderBase<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
  TBuilder,
> extends OperationObserverBuilderBase<TBuilder, TProgress, TOutput> {
  start(): AsyncResult<OperationRef<TDesc, TProgress, TOutput>, UnexpectedError>;
}

export interface TransferOperationBuilder<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> extends OperationObserverBuilderBase<
  TransferOperationBuilder<TDesc, TProgress, TOutput>,
  TProgress,
  TOutput
> {
  onTransfer(
    handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onTransfer"]>,
  ): TransferOperationBuilder<TDesc, TProgress, TOutput>;
  start(): AsyncResult<
    StartedTransfer<TDesc, TProgress, TOutput>,
    UnexpectedError | TransferError
  >;
}

export interface OperationInputBuilder<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> extends OperationInputBuilderBase<
  TDesc,
  TProgress,
  TOutput,
  OperationInputBuilder<TDesc, TProgress, TOutput>
> {
}

export interface TransferCapableOperationInputBuilder<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> extends OperationInputBuilderBase<
  TDesc,
  TProgress,
  TOutput,
  TransferCapableOperationInputBuilder<TDesc, TProgress, TOutput>
> {
  transfer(body: TransferBody): TransferOperationBuilder<TDesc, TProgress, TOutput>;
}

type OperationAcceptedEnvelope<TProgress = unknown, TOutput = unknown> = {
  kind: "accepted";
  ref: OperationRefData;
  snapshot: OperationSnapshot<TProgress, TOutput>;
  transfer?: UploadTransferGrant;
};

type OperationSnapshotFrame<TProgress = unknown, TOutput = unknown> = {
  kind: "snapshot";
  snapshot: OperationSnapshot<TProgress, TOutput>;
};

type OperationControlErrorFrame = {
  kind: "error";
  error: {
    type: string;
    message: string;
  };
};

type OperationShape = {
  subject: string;
  input: unknown;
  progress?: unknown;
  output?: unknown;
  transfer?: {
    store: string;
    key: `/${string}`;
    contentType?: `/${string}`;
    metadata?: `/${string}`;
    expiresInMs?: number;
    maxBytes?: number;
  };
  cancel?: boolean;
};

type OperationInputOf<TDesc extends OperationShape> = InferSchemaType<TDesc["input"]>;
type OperationProgressOf<TDesc extends OperationShape> = TDesc["progress"] extends undefined ? unknown
  : InferSchemaType<NonNullable<TDesc["progress"]>>;
type OperationOutputOf<TDesc extends OperationShape> = TDesc["output"] extends undefined ? unknown
  : InferSchemaType<NonNullable<TDesc["output"]>>;

export interface OperationTransport {
  requestJson(
    subject: string,
    body: JsonValue,
  ): AsyncResult<JsonValue, UnexpectedError>;
  watchJson(
    subject: string,
    body: JsonValue,
  ): AsyncResult<AsyncIterable<Result<JsonValue, UnexpectedError>>, UnexpectedError>;
  putTransfer(
    grant: UploadTransferGrant,
    body: TransferBody,
  ): AsyncResult<FileInfo, TransferError>;
}

function operationRequestBody(input: unknown): JsonValue {
  return input as JsonValue;
}

export function controlSubject(subject: string): string {
  return `${subject}.control`;
}

function isTerminalState(state: OperationState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function snapshotToEvent<TProgress, TOutput>(
  snapshot: OperationSnapshot<TProgress, TOutput>,
): OperationEvent<TProgress, TOutput> {
  switch (snapshot.state) {
    case "pending":
      return { type: "accepted", snapshot };
    case "running":
      return { type: "started", snapshot };
    case "completed":
      return { type: "completed", snapshot: snapshot as TerminalOperation<TProgress, TOutput> };
    case "failed":
      return { type: "failed", snapshot: snapshot as TerminalOperation<TProgress, TOutput> };
    case "cancelled":
      return { type: "cancelled", snapshot: snapshot as TerminalOperation<TProgress, TOutput> };
  }
}

function isTerminalEvent<TProgress, TOutput>(
  event: OperationEvent<TProgress, TOutput>,
): event is Extract<
  OperationEvent<TProgress, TOutput>,
  { type: "completed" | "failed" | "cancelled" }
> {
  return event.type === "completed" || event.type === "failed" || event.type === "cancelled";
}

function normalizeOperationEvent<TProgress, TOutput>(
  event: OperationEvent<TProgress, TOutput>,
): Result<OperationEvent<TProgress, TOutput>, UnexpectedError> {
  try {
    switch (event.type) {
      case "transfer": {
        const transfer = event.transfer ?? event.snapshot.transfer;
        if (!transfer) {
          throw new Error("transfer event is missing transfer progress");
        }
        return ok({
          type: "transfer",
          transfer,
          snapshot: {
            ...event.snapshot,
            transfer,
          },
        });
      }

      case "progress": {
        const progress = event.progress ?? event.snapshot.progress;
        if (progress === undefined) {
          throw new Error("progress event is missing progress payload");
        }
        return ok({
          type: "progress",
          progress,
          snapshot: {
            ...event.snapshot,
            progress,
          },
        });
      }

      default:
        return ok(event);
    }
  } catch (cause) {
    return err(new UnexpectedError({ cause }));
  }
}

async function dispatchObservedOperationEvent<TProgress, TOutput>(
  options: OperationObserverCallbacks<TProgress, TOutput>,
  event: OperationEvent<TProgress, TOutput>,
): Promise<void> {
  switch (event.type) {
    case "accepted":
      await options.onAccepted?.(event);
      break;
    case "started":
      await options.onStarted?.(event);
      break;
    case "transfer":
      await options.onTransfer?.(event);
      break;
    case "progress":
      await options.onProgress?.(event);
      break;
    case "completed":
      await options.onCompleted?.(event);
      break;
    case "failed":
      await options.onFailed?.(event);
      break;
    case "cancelled":
      await options.onCancelled?.(event);
      break;
  }

  await options.onEvent?.(event);
}

function hasObserverCallbacks<TProgress, TOutput>(
  options: OperationObserverCallbacks<TProgress, TOutput>,
): boolean {
  return Boolean(
    options.onAccepted ||
      options.onStarted ||
      options.onTransfer ||
      options.onProgress ||
      options.onCompleted ||
      options.onFailed ||
      options.onCancelled ||
      options.onEvent,
  );
}

function decodeAcceptedEnvelope<TProgress, TOutput>(
  value: JsonValue,
): Result<OperationAcceptedEnvelope<TProgress, TOutput>, UnexpectedError> {
  try {
    const envelope = value as OperationAcceptedEnvelope<TProgress, TOutput>;
    if (envelope?.kind !== "accepted" || !envelope.ref || !envelope.snapshot) {
      throw new Error(
        `Expected accepted operation envelope, got ${JSON.stringify(value)}`,
      );
    }
    return ok(envelope);
  } catch (cause) {
    return err(new UnexpectedError({ cause }));
  }
}

function decodeSnapshotFrame<TProgress, TOutput>(
  value: JsonValue,
): Result<OperationSnapshotFrame<TProgress, TOutput>, UnexpectedError> {
  try {
    if (isOperationControlErrorFrame(value)) {
      return err(controlFrameToUnexpectedError(value));
    }

    const frame = value as OperationSnapshotFrame<TProgress, TOutput>;
    if (frame?.kind !== "snapshot" || !frame.snapshot) {
      throw new Error("Expected snapshot operation frame");
    }
    return ok(frame);
  } catch (cause) {
    return err(new UnexpectedError({ cause }));
  }
}

class RuntimeOperationRef<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> {
  readonly id: string;
  readonly service: string;
  readonly operation: string;

  readonly #transport: OperationTransport;
  readonly #descriptor: TDesc;
  readonly #acceptedTransfer?: UploadTransferGrant;

  constructor(
    transport: OperationTransport,
    descriptor: TDesc,
    ref: OperationRefData,
    acceptedTransfer?: UploadTransferGrant,
  ) {
    this.#transport = transport;
    this.#descriptor = descriptor;
    this.id = ref.id;
    this.service = ref.service;
    this.operation = ref.operation;
    this.#acceptedTransfer = acceptedTransfer;
  }

  isCancelable(): boolean {
    return this.#descriptor.cancel === true;
  }

  get(): AsyncResult<OperationSnapshot<TProgress, TOutput>, UnexpectedError> {
    return this.#controlSnapshot("get");
  }

  wait(): AsyncResult<TerminalOperation<TProgress, TOutput>, UnexpectedError> {
    return AsyncResult.from((async () => {
      const snapshotValue = await this.#controlSnapshot("wait").take();
      if (isErr(snapshotValue)) {
        return snapshotValue;
      }
      if (!isTerminalState(snapshotValue.state)) {
        return err(new UnexpectedError({ cause: new Error("wait returned non-terminal snapshot") }));
      }
      return ok(snapshotValue as TerminalOperation<TProgress, TOutput>);
    })());
  }

  cancel(): AsyncResult<OperationSnapshot<TProgress, TOutput>, UnexpectedError> {
    return this.#controlSnapshot("cancel");
  }

  startTransfer(body: TransferBody): AsyncResult<FileInfo, TransferError> {
    const grant = this.#acceptedTransfer;
    if (!grant) {
      return AsyncResult.err(new TransferError({
        operation: "transfer",
        context: { reason: "missing_transfer" },
      }));
    }
    return this.#transport.putTransfer(grant, body);
  }

  watch(): AsyncResult<AsyncIterable<OperationEvent<TProgress, TOutput>>, UnexpectedError> {
    return AsyncResult.from((async () => {
      const rawIterable = await this.#transport.watchJson(
        controlSubject(this.#descriptor.subject),
        {
          action: "watch",
          operationId: this.id,
        },
      ).take();
      if (isErr(rawIterable)) {
        return err(rawIterable.error);
      }
      const iterable = rawIterable as AsyncIterable<Result<JsonValue, UnexpectedError>>;

      async function* events() {
        for await (const frame of iterable) {
          const frameValue = frame.take();
          if (isErr(frameValue)) {
            throw frameValue.error;
          }
          const decoded = decodeWatchFrame<TProgress, TOutput>(frameValue);
          const decodedValue = decoded.take();
          if (isErr(decodedValue)) {
            throw decodedValue.error;
          }
          if (decodedValue === null) {
            continue;
          }
          const normalized = normalizeOperationEvent(decodedValue).take();
          if (isErr(normalized)) {
            throw normalized.error;
          }
          yield normalized;
          if (isTerminalEvent(normalized)) {
            break;
          }
        }
      }

      return ok(events());
    })());
  }

  #controlSnapshot(
    action: "get" | "wait" | "cancel" | "watch",
  ): AsyncResult<OperationSnapshot<TProgress, TOutput>, UnexpectedError> {
    return AsyncResult.from((async () => {
      const responseValue = await this.#transport.requestJson(
        controlSubject(this.#descriptor.subject),
        {
          action,
          operationId: this.id,
        },
      ).take();
      if (isErr(responseValue)) {
        return responseValue;
      }

      const frame = decodeSnapshotFrame<TProgress, TOutput>(
        responseValue,
      ).take();
      if (isErr(frame)) {
        return frame;
      }
      return ok(frame.snapshot);
    })());
  }
}

function decodeWatchFrame<TProgress, TOutput>(
  value: JsonValue,
): Result<OperationEvent<TProgress, TOutput> | null, UnexpectedError> {
  try {
    if (value && typeof value === "object" && (value as { kind?: string }).kind === "keepalive") {
      return ok(null);
    }

    if (isOperationControlErrorFrame(value)) {
      return err(controlFrameToUnexpectedError(value));
    }

    const frame = value as
      | { kind: "snapshot"; snapshot: OperationSnapshot<TProgress, TOutput> }
      | { kind: "event"; event: OperationEvent<TProgress, TOutput> };

    if ((frame as { kind?: string }).kind === "snapshot" && "snapshot" in frame) {
      return ok(snapshotToEvent(frame.snapshot));
    }
    if ((frame as { kind?: string }).kind === "event" && "event" in frame) {
      return ok(frame.event);
    }

    throw new Error("Expected snapshot, event, or keepalive frame");
  } catch (cause) {
    return err(new UnexpectedError({ cause }));
  }
}

type OperationWatchObservation<TProgress, TOutput> = {
  task?: Promise<Result<TerminalOperation<TProgress, TOutput>, UnexpectedError>>;
  close?: () => Promise<void>;
};

type ObservedWatchOptions<TProgress, TOutput> = {
  ready?: Promise<void>;
  skipEvent?: (event: OperationEvent<TProgress, TOutput>) => boolean;
};

type InvokedOperation<TDesc extends OperationShape, TProgress, TOutput> = {
  accepted: AcceptedOperationEvent<TProgress, TOutput>;
  operation: RuntimeOperationRef<TDesc, TProgress, TOutput>;
};

function invokeOperation<TDesc extends OperationShape, TProgress, TOutput>(
  transport: OperationTransport,
  descriptor: TDesc,
  input: unknown,
): AsyncResult<InvokedOperation<TDesc, TProgress, TOutput>, UnexpectedError> {
  return AsyncResult.from((async () => {
    const responseValue = await transport.requestJson(
      descriptor.subject,
      operationRequestBody(input),
    ).take();
    if (isErr(responseValue)) {
      return responseValue;
    }

    const envelope = decodeAcceptedEnvelope<TProgress, TOutput>(responseValue).take();
    if (isErr(envelope)) {
      return envelope;
    }

    return ok({
      accepted: {
        type: "accepted",
        snapshot: envelope.snapshot,
      },
      operation: new RuntimeOperationRef<TDesc, TProgress, TOutput>(
        transport,
        descriptor,
        envelope.ref,
        envelope.transfer,
      ),
    });
  })());
}

function beginObservedWatch<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
>(
  operation: RuntimeOperationRef<TDesc, TProgress, TOutput>,
  callbacks: OperationObserverCallbacks<TProgress, TOutput>,
  options: ObservedWatchOptions<TProgress, TOutput> = {},
): AsyncResult<OperationWatchObservation<TProgress, TOutput>, UnexpectedError> {
  if (!hasObserverCallbacks(callbacks)) {
    return AsyncResult.ok({});
  }

  return AsyncResult.from((async () => {
    const watchValue = await operation.watch().take();
    if (isErr(watchValue)) {
      return watchValue;
    }

    const iterator = watchValue[Symbol.asyncIterator]();
    const close = async () => {
      await iterator.return?.();
    };

    const task = (async (): Promise<Result<TerminalOperation<TProgress, TOutput>, UnexpectedError>> => {
      try {
        await options.ready;

        while (true) {
          const next = await iterator.next();
          if (next.done) {
            break;
          }

          const event = next.value;
          if (options.skipEvent?.(event)) {
            continue;
          }
          try {
            await dispatchObservedOperationEvent(callbacks, event);
          } catch (cause) {
            return err(toObservedCallbackError(cause));
          }
          if (isTerminalEvent(event)) {
            await close();
            return ok(event.snapshot as TerminalOperation<TProgress, TOutput>);
          }
        }

        return err(new UnexpectedError({
          cause: new Error("operation watch ended before terminal event"),
        }));
      } catch (cause) {
        return err(cause instanceof UnexpectedError
          ? cause
          : new UnexpectedError({ cause }));
      }
    })();

    return ok({ task, close });
  })());
}

function startObservedOperation<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
>(
  transport: OperationTransport,
  descriptor: TDesc,
  input: unknown,
  callbacks: OperationObserverCallbacks<TProgress, TOutput>,
): AsyncResult<OperationRef<TDesc, TProgress, TOutput>, UnexpectedError> {
  return AsyncResult.from((async () => {
    const startedValue = await invokeOperation<TDesc, TProgress, TOutput>(
      transport,
      descriptor,
      input,
    ).take();
    if (isErr(startedValue)) {
      return startedValue;
    }

    const ready = deferred<void>();

    const observedValue = await beginObservedWatch(startedValue.operation, callbacks, {
      ready: ready.promise,
      skipEvent: createAcceptedReplayFilter(startedValue.accepted),
    }).take();
    const observation = isErr(observedValue) ? {} : observedValue;

    const accepted = await dispatchOperationEventResult(callbacks, startedValue.accepted);
    if (accepted.isErr()) {
      if (!isErr(observedValue)) {
        ready.resolve();
        await observation.close?.();
      }
      return ok(createPublicOperationRef(
        startedValue.operation,
        failedObservation(accepted.error),
      ));
    }

    if (!isErr(observedValue)) {
      ready.resolve();
    }
    return ok(createPublicOperationRef(startedValue.operation, observation));
  })());
}

function startObservedTransfer<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
>(
  transport: OperationTransport,
  descriptor: TDesc,
  input: unknown,
  body: TransferBody,
  callbacks: OperationObserverCallbacks<TProgress, TOutput>,
): AsyncResult<StartedTransfer<TDesc, TProgress, TOutput>, UnexpectedError | TransferError> {
  return AsyncResult.from((async () => {
    const startedValue = await invokeOperation<TDesc, TProgress, TOutput>(
      transport,
      descriptor,
      input,
    ).take();
    if (isErr(startedValue)) {
      return startedValue;
    }

    const operation = startedValue.operation;
    const ready = deferred<void>();
    const observedValue = await beginObservedWatch(operation, callbacks, {
      ready: ready.promise,
      skipEvent: createAcceptedReplayFilter(startedValue.accepted),
    }).take();
    const observation = isErr(observedValue) ? {} : observedValue;

    const accepted = await dispatchOperationEventResult(callbacks, startedValue.accepted);
    if (accepted.isErr()) {
      if (!isErr(observedValue)) {
        ready.resolve();
        await observation.close?.();
      }
    }

    if (!isErr(observedValue)) {
      ready.resolve();
    }

    const transferTask = (async () => {
      const transferredValue = await operation.startTransfer(body).take();
      if (isErr(transferredValue)) {
        await observation.close?.();
        return transferredValue;
      }

      return ok(transferredValue);
    })();

    const publicOperation = createPublicOperationRef(
      operation,
      accepted.isErr() ? failedObservation(accepted.error) : observation,
    );

    return ok({
      operation: publicOperation,
      wait: () => AsyncResult.from((async () => {
        const transferred = await transferTask;
        const transferredValue = transferred.take();
        if (isErr(transferredValue)) {
          return transferredValue;
        }

        const terminalValue = await publicOperation.wait().take();
        if (isErr(terminalValue)) {
          return terminalValue;
        }

        return ok({
          transferred: transferredValue,
          terminal: terminalValue,
        });
      })()),
    });
  })());
}

function createObservedOperationRef<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
>(
  operation: RuntimeOperationRef<TDesc, TProgress, TOutput>,
  observation: OperationWatchObservation<TProgress, TOutput>,
): OperationRef<TDesc, TProgress, TOutput> {
  return createPublicOperationRef(operation, observation);
}

function createPublicOperationRef<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
>(
  operation: RuntimeOperationRef<TDesc, TProgress, TOutput>,
  observation: OperationWatchObservation<TProgress, TOutput>,
): OperationRef<TDesc, TProgress, TOutput> {
  const base = {
    id: operation.id,
    service: operation.service,
    operation: operation.operation,
    get: () => operation.get(),
    wait: () => AsyncResult.from((async () => {
      if (observation.task) {
        const terminal = await observation.task;
        const terminalValue = terminal.take();
        if (!isErr(terminalValue)) {
          return ok(terminalValue);
        }
        if (isObservedCallbackError(terminalValue.error)) {
          return terminalValue;
        }
      }

      return await operation.wait();
    })()),
    watch: () => operation.watch(),
  };

  if (!operation.isCancelable()) {
    return base as OperationRef<TDesc, TProgress, TOutput>;
  }

  return {
    ...base,
    cancel: () => operation.cancel(),
  } as OperationRef<TDesc, TProgress, TOutput>;
}

function createOperationInputBuilder<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
>(
  transport: OperationTransport,
  descriptor: TDesc,
  input: unknown,
  callbacks: OperationObserverCallbacks<TProgress, TOutput> = {},
): TDesc["transfer"] extends undefined ? OperationInputBuilder<TDesc, TProgress, TOutput>
  : TransferCapableOperationInputBuilder<TDesc, TProgress, TOutput> {
  const rebuild = (
    nextCallbacks: OperationObserverCallbacks<TProgress, TOutput>,
  ) => createOperationInputBuilder<TDesc, TProgress, TOutput>(
    transport,
    descriptor,
    input,
    nextCallbacks,
  );

  const baseBuilder = {
    onAccepted(handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onAccepted"]>) {
      return rebuild({ ...callbacks, onAccepted: handler });
    },
    onStarted(handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onStarted"]>) {
      return rebuild({ ...callbacks, onStarted: handler });
    },
    onProgress(handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onProgress"]>) {
      return rebuild({ ...callbacks, onProgress: handler });
    },
    onCompleted(handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onCompleted"]>) {
      return rebuild({ ...callbacks, onCompleted: handler });
    },
    onFailed(handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onFailed"]>) {
      return rebuild({ ...callbacks, onFailed: handler });
    },
    onCancelled(handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onCancelled"]>) {
      return rebuild({ ...callbacks, onCancelled: handler });
    },
    onEvent(handler: NonNullable<OperationObserverCallbacks<TProgress, TOutput>["onEvent"]>) {
      return rebuild({ ...callbacks, onEvent: handler });
    },
    start() {
      return startObservedOperation<TDesc, TProgress, TOutput>(
        transport,
        descriptor,
        input,
        callbacks,
      );
    },
  } satisfies OperationInputBuilderBase<
    TDesc,
    TProgress,
    TOutput,
    OperationInputBuilder<TDesc, TProgress, TOutput>
  >;

  if (descriptor.transfer) {
    return {
      ...baseBuilder,
      transfer(body: TransferBody) {
        return createTransferOperationBuilder<TDesc, TProgress, TOutput>(
          transport,
          descriptor,
          input,
          body,
          callbacks,
        );
      },
    } as TDesc["transfer"] extends undefined ? OperationInputBuilder<TDesc, TProgress, TOutput>
      : TransferCapableOperationInputBuilder<TDesc, TProgress, TOutput>;
  }

  return baseBuilder as TDesc["transfer"] extends undefined ? OperationInputBuilder<TDesc, TProgress, TOutput>
    : TransferCapableOperationInputBuilder<TDesc, TProgress, TOutput>;
}

function createTransferOperationBuilder<
  TDesc extends OperationShape,
  TProgress,
  TOutput,
>(
  transport: OperationTransport,
  descriptor: TDesc,
  input: unknown,
  body: TransferBody,
  callbacks: OperationObserverCallbacks<TProgress, TOutput> = {},
): TransferOperationBuilder<TDesc, TProgress, TOutput> {
  const rebuild = (
    nextCallbacks: OperationObserverCallbacks<TProgress, TOutput>,
  ) => createTransferOperationBuilder<TDesc, TProgress, TOutput>(
    transport,
    descriptor,
    input,
    body,
    nextCallbacks,
  );

  return {
    onAccepted(handler) {
      return rebuild({ ...callbacks, onAccepted: handler });
    },
    onStarted(handler) {
      return rebuild({ ...callbacks, onStarted: handler });
    },
    onTransfer(handler) {
      return rebuild({ ...callbacks, onTransfer: handler });
    },
    onProgress(handler) {
      return rebuild({ ...callbacks, onProgress: handler });
    },
    onCompleted(handler) {
      return rebuild({ ...callbacks, onCompleted: handler });
    },
    onFailed(handler) {
      return rebuild({ ...callbacks, onFailed: handler });
    },
    onCancelled(handler) {
      return rebuild({ ...callbacks, onCancelled: handler });
    },
    onEvent(handler) {
      return rebuild({ ...callbacks, onEvent: handler });
    },
    start() {
      return startObservedTransfer<TDesc, TProgress, TOutput>(
        transport,
        descriptor,
        input,
        body,
        callbacks,
      );
    },
  };
}

export class OperationInvoker<
  TDesc extends OperationShape,
  TInput = OperationInputOf<TDesc>,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> {
  readonly #transport: OperationTransport;
  readonly #descriptor: TDesc;

  constructor(transport: OperationTransport, descriptor: TDesc) {
    this.#transport = transport;
    this.#descriptor = descriptor;
  }

  resume(ref: OperationRefData): OperationRef<TDesc, TProgress, TOutput> {
    return createPublicOperationRef(new RuntimeOperationRef<TDesc, TProgress, TOutput>(
      this.#transport,
      this.#descriptor,
      ref,
    ), {});
  }

  input(
    input: TInput,
  ): TDesc["transfer"] extends undefined ? OperationInputBuilder<TDesc, TProgress, TOutput>
    : TransferCapableOperationInputBuilder<TDesc, TProgress, TOutput> {
    return createOperationInputBuilder<TDesc, TProgress, TOutput>(
      this.#transport,
      this.#descriptor,
      input as OperationInputOf<TDesc>,
    ) as TDesc["transfer"] extends undefined ? OperationInputBuilder<TDesc, TProgress, TOutput>
      : TransferCapableOperationInputBuilder<TDesc, TProgress, TOutput>;
  }
}

function isOperationControlErrorFrame(value: JsonValue): value is OperationControlErrorFrame {
  return !!value && typeof value === "object" && (value as { kind?: string }).kind === "error" &&
    typeof Reflect.get(value, "error") === "object";
}

function controlFrameToUnexpectedError(frame: OperationControlErrorFrame): UnexpectedError {
  return new UnexpectedError({
    cause: new Error(`Operation control error ${frame.error.type}: ${frame.error.message}`),
    context: {
      controlErrorType: frame.error.type,
      controlErrorMessage: frame.error.message,
    },
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createAcceptedReplayFilter<TProgress, TOutput>(
  accepted: AcceptedOperationEvent<TProgress, TOutput>,
): (event: OperationEvent<TProgress, TOutput>) => boolean {
  return (event) => {
    return event.type === "accepted" &&
      event.snapshot.id === accepted.snapshot.id &&
      event.snapshot.service === accepted.snapshot.service &&
      event.snapshot.operation === accepted.snapshot.operation &&
      event.snapshot.revision === accepted.snapshot.revision &&
      event.snapshot.state === accepted.snapshot.state;
  };
}

function failedObservation<TProgress, TOutput>(
  error: UnexpectedError,
): OperationWatchObservation<TProgress, TOutput> {
  return {
    task: Promise.resolve(err(error)),
  };
}

async function dispatchOperationEventResult<TProgress, TOutput>(
  callbacks: OperationObserverCallbacks<TProgress, TOutput>,
  event: OperationEvent<TProgress, TOutput>,
): Promise<Result<void, UnexpectedError>> {
  try {
    await dispatchObservedOperationEvent(callbacks, event);
    return ok(undefined);
  } catch (cause) {
    return err(toObservedCallbackError(cause));
  }
}

function toObservedCallbackError(cause: unknown): UnexpectedError {
  return (cause instanceof UnexpectedError ? cause : new UnexpectedError({ cause }))
    .withContext({ operationObserverCallback: true });
}

function isObservedCallbackError(error: UnexpectedError): boolean {
  return error.getContext().operationObserverCallback === true;
}
