import type {
  InferSchemaType,
} from "./contracts.ts";
import { err, isErr, ok, type Result } from "@qlever-llc/result";

import type { JsonValue } from "./codec.ts";
import { UnexpectedError } from "./errors/index.ts";

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
  output?: TOutput;
  error?: {
    type: string;
    message: string;
  };
};

export type TerminalOperation<TProgress = unknown, TOutput = unknown> =
  OperationSnapshot<TProgress, TOutput> & {
    state: "completed" | "failed" | "cancelled";
  };

export type OperationEvent<TProgress = unknown, TOutput = unknown> =
  | { type: "accepted"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | { type: "started"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | { type: "progress"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | { type: "completed"; snapshot: TerminalOperation<TProgress, TOutput> }
  | { type: "failed"; snapshot: TerminalOperation<TProgress, TOutput> }
  | { type: "cancelled"; snapshot: TerminalOperation<TProgress, TOutput> };

type OperationAcceptedEnvelope<TProgress = unknown, TOutput = unknown> = {
  kind: "accepted";
  ref: OperationRefData;
  snapshot: OperationSnapshot<TProgress, TOutput>;
};

type OperationSnapshotFrame<TProgress = unknown, TOutput = unknown> = {
  kind: "snapshot";
  snapshot: OperationSnapshot<TProgress, TOutput>;
};

type OperationShape = {
  subject: string;
  input: unknown;
  progress?: unknown;
  output?: unknown;
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
  ): Promise<Result<JsonValue, UnexpectedError>>;
  watchJson(
    subject: string,
    body: JsonValue,
  ): Promise<Result<AsyncIterable<Result<JsonValue, UnexpectedError>>, UnexpectedError>>;
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
): boolean {
  return event.type === "completed" || event.type === "failed" || event.type === "cancelled";
}

function decodeAcceptedEnvelope<TProgress, TOutput>(
  value: JsonValue,
): Result<OperationAcceptedEnvelope<TProgress, TOutput>, UnexpectedError> {
  try {
    const envelope = value as OperationAcceptedEnvelope<TProgress, TOutput>;
    if (envelope?.kind !== "accepted" || !envelope.ref || !envelope.snapshot) {
      throw new Error("Expected accepted operation envelope");
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
    const frame = value as OperationSnapshotFrame<TProgress, TOutput>;
    if (frame?.kind !== "snapshot" || !frame.snapshot) {
      throw new Error("Expected snapshot operation frame");
    }
    return ok(frame);
  } catch (cause) {
    return err(new UnexpectedError({ cause }));
  }
}

export class OperationRef<
  TDesc extends OperationShape,
  TProgress = OperationProgressOf<TDesc>,
  TOutput = OperationOutputOf<TDesc>,
> {
  readonly id: string;
  readonly service: string;
  readonly operation: string;

  readonly #transport: OperationTransport;
  readonly #descriptor: TDesc;

  constructor(transport: OperationTransport, descriptor: TDesc, ref: OperationRefData) {
    this.#transport = transport;
    this.#descriptor = descriptor;
    this.id = ref.id;
    this.service = ref.service;
    this.operation = ref.operation;
  }

  async get(): Promise<Result<OperationSnapshot<TProgress, TOutput>, UnexpectedError>> {
    return this.#controlSnapshot("get");
  }

  async wait(): Promise<Result<TerminalOperation<TProgress, TOutput>, UnexpectedError>> {
    const snapshot = await this.#controlSnapshot("wait");
    if (snapshot.isErr()) {
      return snapshot;
    }
    const snapshotValue = snapshot.take();
    if (isErr(snapshotValue)) {
      return snapshotValue;
    }
    if (!isTerminalState(snapshotValue.state)) {
      return err(new UnexpectedError({ cause: new Error("wait returned non-terminal snapshot") }));
    }
    return ok(snapshotValue as TerminalOperation<TProgress, TOutput>);
  }

  async cancel(): Promise<Result<OperationSnapshot<TProgress, TOutput>, UnexpectedError>> {
    return this.#controlSnapshot("cancel");
  }

  async watch(): Promise<Result<AsyncIterable<OperationEvent<TProgress, TOutput>>, UnexpectedError>> {
    const response = await this.#transport.watchJson(
      controlSubject(this.#descriptor.subject),
      {
        action: "watch",
        operationId: this.id,
      },
    );
    if (response.isErr()) {
      return err(response.error);
    }

    const rawIterable = response.take();
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
        yield decodedValue;
        if (isTerminalEvent(decodedValue)) {
          break;
        }
      }
    }

    return ok(events());
  }

  async #controlSnapshot(
    action: "get" | "wait" | "cancel" | "watch",
  ): Promise<Result<OperationSnapshot<TProgress, TOutput>, UnexpectedError>> {
    const response = await this.#transport.requestJson(
      controlSubject(this.#descriptor.subject),
      {
        action,
        operationId: this.id,
      },
    );
    if (response.isErr()) {
      return response;
    }
    const responseValue = response.take();
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
  }
}

function decodeWatchFrame<TProgress, TOutput>(
  value: JsonValue,
): Result<OperationEvent<TProgress, TOutput> | null, UnexpectedError> {
  try {
    if (value && typeof value === "object" && (value as { kind?: string }).kind === "keepalive") {
      return ok(null);
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

  async start(
    input: TInput,
  ): Promise<Result<OperationRef<TDesc, TProgress, TOutput>, UnexpectedError>> {
    const response = await this.#transport.requestJson(
      this.#descriptor.subject,
      input as JsonValue,
    );
    if (response.isErr()) {
      return response;
    }
    const responseValue = response.take();
    if (isErr(responseValue)) {
      return responseValue;
    }

    const envelope = decodeAcceptedEnvelope<TProgress, TOutput>(responseValue).take();
    if (isErr(envelope)) {
      return envelope;
    }

    return ok(new OperationRef<TDesc, TProgress, TOutput>(
      this.#transport,
      this.#descriptor,
      envelope.ref,
    ));
  }
}
