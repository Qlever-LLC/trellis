import {
  AsyncResult,
  isErr,
  Result,
  type Result as ResultType,
} from "@qlever-llc/result";
import {
  headers as natsHeaders,
  type Msg,
  type NatsConnection,
  type Subscription,
} from "@nats-io/nats-core";
import { ulid } from "ulid";

import type {
  OperationTransferHandle,
  RuntimeOperationTransferProgress,
  TrellisAuth,
} from "../trellis.ts";
import type { StoreError } from "../errors/StoreError.ts";
import { TransferError } from "../errors/TransferError.ts";
import { type StoreInfo, TypedStore, TypedStoreEntry } from "../store.ts";
import type {
  FileInfo,
  ReceiveTransferGrant,
  SendTransferGrant,
} from "../transfer.ts";
import { verifyTransferMessage } from "../transfer.ts";

const UPLOAD_SUBJECT_PREFIX = "transfer.v1.upload";
const DOWNLOAD_SUBJECT_PREFIX = "transfer.v1.download";
const TRANSFER_SEQUENCE_HEADER = "trellis-transfer-seq";
const TRANSFER_EOF_HEADER = "trellis-transfer-eof";
const DEFAULT_TRANSFER_CHUNK_BYTES = 256 * 1024;

export type TransferStoreHandle = {
  open(): AsyncResult<TypedStore, StoreError>;
};

export type InitiateUploadArgs = {
  sessionKey: string;
  store: string;
  key: string;
  expiresInMs: number;
  maxBytes?: number;
  contentType?: string;
  metadata?: Record<string, string>;
  onProgress?: (
    progress: RuntimeOperationTransferProgress,
  ) => Promise<void> | void;
  onComplete?: (info: FileInfo) => Promise<void> | void;
  onError?: (error: TransferError) => Promise<void> | void;
  onStored?: (stored: StoredTransfer) => Promise<void> | void;
};

export type OperationUploadTransfer = {
  grant: SendTransferGrant;
  transfer: OperationTransferHandle;
};

export type InitiateDownloadArgs = {
  sessionKey: string;
  store: string;
  key: string;
  expiresInMs: number;
};

type ServiceTransferOpts = {
  name: string;
  nc: NatsConnection;
  auth: TrellisAuth;
  stores: Record<string, TransferStoreHandle>;
  chunkBytes?: number;
};

export type StoredTransfer = {
  transferId: string;
  sessionKey: string;
  store: TypedStore;
  entry: TypedStoreEntry;
  info: FileInfo;
};

type UploadSession = {
  kind: "upload";
  subject: string;
  transferId: string;
  sessionKey: string;
  expiresAtMs: number;
  store: TypedStore;
  key: string;
  maxBytes?: number;
  contentType?: string;
  metadata?: Record<string, string>;
  onProgress?: (
    progress: RuntimeOperationTransferProgress,
  ) => Promise<void> | void;
  onComplete?: (info: FileInfo) => Promise<void> | void;
  onError?: (error: TransferError) => Promise<void> | void;
  onStored?: (stored: StoredTransfer) => Promise<void> | void;
  subscription: Subscription;
  timeoutId: ReturnType<typeof setTimeout>;
  queue: AsyncChunkQueue;
  putPromise: AsyncResult<void, StoreError>;
  nextSeq: number;
  receivedBytes: number;
};

type DownloadSession = {
  kind: "download";
  subject: string;
  transferId: string;
  sessionKey: string;
  expiresAtMs: number;
  store: TypedStore;
  key: string;
  info: FileInfo;
  subscription: Subscription;
  timeoutId: ReturnType<typeof setTimeout>;
};

function effectiveUploadMaxBytes(
  argsMaxBytes?: number,
  storeMaxObjectBytes?: number,
): number | undefined {
  if (argsMaxBytes === undefined) {
    return storeMaxObjectBytes;
  }
  if (storeMaxObjectBytes === undefined) {
    return argsMaxBytes;
  }
  return Math.min(argsMaxBytes, storeMaxObjectBytes);
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

class AsyncValueQueue<T> implements AsyncIterable<T> {
  #values: T[] = [];
  #resolvers: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) {
      return;
    }

    const resolver = this.#resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }

    this.#values.push(value);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    while (this.#resolvers.length > 0) {
      const resolver = this.#resolvers.shift();
      resolver?.({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const value = this.#values.shift();
        if (value !== undefined) {
          return { value, done: false };
        }
        if (this.#closed) {
          return { value: undefined as T, done: true };
        }
        return await new Promise<IteratorResult<T>>((resolve) => {
          this.#resolvers.push(resolve);
        });
      },
    };
  }
}

class AsyncValueBroadcaster<T> {
  #subscribers = new Set<AsyncValueQueue<T>>();
  #closed = false;

  push(value: T): void {
    if (this.#closed) {
      return;
    }

    for (const subscriber of this.#subscribers) {
      subscriber.push(value);
    }
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    for (const subscriber of this.#subscribers) {
      subscriber.close();
    }
    this.#subscribers.clear();
  }

  subscribe(): AsyncIterable<T> {
    const subscriber = new AsyncValueQueue<T>();
    if (this.#closed) {
      subscriber.close();
    } else {
      this.#subscribers.add(subscriber);
    }

    const subscribers = this.#subscribers;

    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const value of subscriber) {
            yield value;
          }
        } finally {
          subscribers.delete(subscriber);
        }
      },
    };
  }
}

class AsyncChunkQueue implements AsyncIterable<Uint8Array> {
  #values: Uint8Array[] = [];
  #resolvers: Array<(result: IteratorResult<Uint8Array>) => void> = [];
  #closed = false;
  #error: unknown;

  push(chunk: Uint8Array): void {
    if (this.#closed) {
      return;
    }

    const resolver = this.#resolvers.shift();
    if (resolver) {
      resolver({ value: chunk, done: false });
      return;
    }

    this.#values.push(chunk);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    while (this.#resolvers.length > 0) {
      this.#resolvers.shift()?.({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    if (this.#closed) {
      return;
    }
    this.#error = error;
    this.#closed = true;
    while (this.#resolvers.length > 0) {
      this.#resolvers.shift()?.({ value: undefined, done: true });
    }
  }

  async next(): Promise<IteratorResult<Uint8Array>> {
    if (this.#values.length > 0) {
      return { value: this.#values.shift()!, done: false };
    }
    if (this.#error) {
      throw this.#error;
    }
    if (this.#closed) {
      return { value: undefined, done: true };
    }

    return await new Promise<IteratorResult<Uint8Array>>((resolve) => {
      this.#resolvers.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: () => this.next(),
    };
  }
}

function fileInfoFromStoreInfo(info: StoreInfo): FileInfo {
  return {
    key: info.key,
    size: info.size,
    updatedAt: info.updatedAt,
    ...(info.digest ? { digest: info.digest } : {}),
    ...(info.contentType ? { contentType: info.contentType } : {}),
    metadata: info.metadata,
  };
}

function replyError(msg: Msg, error: TransferError): void {
  const headers = natsHeaders();
  headers.set("status", "error");
  msg.respond(JSON.stringify(error.toSerializable()), { headers });
}

function publishError(
  nc: NatsConnection,
  subject: string,
  error: TransferError,
): void {
  const headers = natsHeaders();
  headers.set("status", "error");
  nc.publish(subject, JSON.stringify(error.toSerializable()), { headers });
}

function parseSeq(msg: Msg): ResultType<number, TransferError> {
  const raw = msg.headers?.get(TRANSFER_SEQUENCE_HEADER);
  if (!raw) {
    return Result.err(
      new TransferError({
        operation: "transfer",
        context: { reason: "missing_sequence" },
      }),
    );
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return Result.err(
      new TransferError({
        operation: "transfer",
        context: { reason: "invalid_sequence", raw },
      }),
    );
  }
  return Result.ok(value);
}

async function* iterateStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return;
      }
      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export class ServiceTransfer {
  readonly #name: string;
  readonly #nc: NatsConnection;
  readonly #auth: TrellisAuth;
  readonly #stores: Record<string, TransferStoreHandle>;
  readonly #chunkBytes: number;
  readonly #uploadSessions = new Map<string, UploadSession>();
  readonly #downloadSessions = new Map<string, DownloadSession>();

  constructor(opts: ServiceTransferOpts) {
    this.#name = opts.name;
    this.#nc = opts.nc;
    this.#auth = opts.auth;
    this.#stores = opts.stores;
    this.#chunkBytes = opts.chunkBytes ?? DEFAULT_TRANSFER_CHUNK_BYTES;
  }

  async initiateUpload(
    args: InitiateUploadArgs,
  ): Promise<ResultType<SendTransferGrant, TransferError>> {
    const store = await this.#openStore(args.store, "initiateUpload");
    const storeValue = store.take();
    if (isErr(storeValue)) {
      return Result.err(storeValue.error);
    }

    const storeStatus = await storeValue.status();
    const storeStatusValue = storeStatus.take();
    if (isErr(storeStatusValue)) {
      return Result.err(
        new TransferError({
          operation: "initiateUpload",
          cause: storeStatusValue.error,
        }),
      );
    }

    const maxBytes = effectiveUploadMaxBytes(
      args.maxBytes,
      storeStatusValue.maxObjectBytes,
    );

    const transferId = ulid();
    const subject = `${UPLOAD_SUBJECT_PREFIX}.${
      this.#auth.sessionKey.slice(0, 16)
    }.${transferId}`;
    const expiresAtMs = Date.now() + args.expiresInMs;
    const queue = new AsyncChunkQueue();
    const subscription = this.#nc.subscribe(subject);
    const putPromise = storeValue.put(args.key, queue, {
      ...(args.contentType ? { contentType: args.contentType } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    });

    const session: UploadSession = {
      kind: "upload",
      subject,
      transferId,
      sessionKey: args.sessionKey,
      expiresAtMs,
      store: storeValue,
      key: args.key,
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(args.contentType ? { contentType: args.contentType } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
      ...(args.onProgress ? { onProgress: args.onProgress } : {}),
      ...(args.onComplete ? { onComplete: args.onComplete } : {}),
      ...(args.onError ? { onError: args.onError } : {}),
      ...(args.onStored ? { onStored: args.onStored } : {}),
      subscription,
      timeoutId: setTimeout(
        () => this.#expireUploadSession(subject),
        args.expiresInMs,
      ),
      queue,
      putPromise,
      nextSeq: 0,
      receivedBytes: 0,
    };

    this.#uploadSessions.set(subject, session);
    this.#runUploadSession(session);

    const ready = await this.#flushSubscriptionInterest("initiateUpload");
    const readyValue = ready.take();
    if (isErr(readyValue)) {
      this.#expireUploadSession(subject, readyValue.error);
      return Result.err(readyValue.error);
    }
    if (!this.#uploadSessions.has(subject)) {
      return Result.err(
        new TransferError({
          operation: "initiateUpload",
          context: { reason: "session_closed" },
        }),
      );
    }
    if (Date.now() >= expiresAtMs) {
      const error = new TransferError({
        operation: "initiateUpload",
        context: { reason: "expired" },
      });
      this.#expireUploadSession(subject, error);
      return Result.err(error);
    }

    return Result.ok({
      type: "TransferGrant",
      direction: "send",
      service: this.#name,
      sessionKey: args.sessionKey,
      transferId,
      subject,
      expiresAt: new Date(expiresAtMs).toISOString(),
      chunkBytes: this.#chunkBytes,
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(args.contentType ? { contentType: args.contentType } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    });
  }

  createOperationUpload(
    args: InitiateUploadArgs,
  ): AsyncResult<OperationUploadTransfer, TransferError> {
    return AsyncResult.from(
      (async (): Promise<
        ResultType<OperationUploadTransfer, TransferError>
      > => {
        const updates = new AsyncValueBroadcaster<
          RuntimeOperationTransferProgress
        >();
        const completed = deferred<ResultType<FileInfo, TransferError>>();
        let settled = false;
        const settle = (value: ResultType<FileInfo, TransferError>) => {
          if (settled) {
            return;
          }
          settled = true;
          updates.close();
          completed.resolve(value);
        };

        const grant = await this.initiateUpload({
          ...args,
          onProgress: async (progress) => {
            updates.push(progress);
            await args.onProgress?.(progress);
          },
          onComplete: async (info) => {
            await args.onComplete?.(info);
            settle(Result.ok(info));
          },
          onError: async (error) => {
            await args.onError?.(error);
            settle(Result.err(error));
          },
          onStored: async (stored) => {
            await args.onStored?.(stored);
          },
        });
        const grantValue = grant.take();
        if (isErr(grantValue)) {
          return Result.err(grantValue.error);
        }

        return Result.ok({
          grant: grantValue,
          transfer: {
            updates: () => updates.subscribe(),
            completed: () => AsyncResult.from(completed.promise),
          },
        });
      })(),
    );
  }

  async initiateDownload(
    args: InitiateDownloadArgs,
  ): Promise<ResultType<ReceiveTransferGrant, TransferError>> {
    const store = await this.#openStore(args.store, "initiateDownload");
    const storeValue = store.take();
    if (isErr(storeValue)) {
      return Result.err(storeValue.error);
    }

    const entry = await storeValue.get(args.key);
    const entryValue = entry.take();
    if (isErr(entryValue)) {
      return Result.err(
        new TransferError({
          operation: "initiateDownload",
          cause: entryValue.error,
        }),
      );
    }

    const transferId = ulid();
    const subject = `${DOWNLOAD_SUBJECT_PREFIX}.${
      this.#auth.sessionKey.slice(0, 16)
    }.${transferId}`;
    const expiresAtMs = Date.now() + args.expiresInMs;
    const subscription = this.#nc.subscribe(subject);
    const session: DownloadSession = {
      kind: "download",
      subject,
      transferId,
      sessionKey: args.sessionKey,
      expiresAtMs,
      store: storeValue,
      key: args.key,
      info: fileInfoFromStoreInfo(entryValue.info),
      subscription,
      timeoutId: setTimeout(
        () => this.#cleanupDownloadSession(subject),
        args.expiresInMs,
      ),
    };

    this.#downloadSessions.set(subject, session);
    this.#runDownloadSession(session);

    const ready = await this.#flushSubscriptionInterest("initiateDownload");
    const readyValue = ready.take();
    if (isErr(readyValue)) {
      this.#cleanupDownloadSession(subject);
      return Result.err(readyValue.error);
    }
    if (!this.#downloadSessions.has(subject)) {
      return Result.err(
        new TransferError({
          operation: "initiateDownload",
          context: { reason: "session_closed" },
        }),
      );
    }
    if (Date.now() >= expiresAtMs) {
      this.#cleanupDownloadSession(subject);
      return Result.err(
        new TransferError({
          operation: "initiateDownload",
          context: { reason: "expired" },
        }),
      );
    }

    return Result.ok({
      type: "TransferGrant",
      direction: "receive",
      service: this.#name,
      sessionKey: args.sessionKey,
      transferId,
      subject,
      expiresAt: new Date(expiresAtMs).toISOString(),
      chunkBytes: this.#chunkBytes,
      info: session.info,
    });
  }

  async stop(): Promise<void> {
    for (const subject of [...this.#uploadSessions.keys()]) {
      this.#expireUploadSession(subject);
    }
    for (const subject of [...this.#downloadSessions.keys()]) {
      this.#cleanupDownloadSession(subject);
    }
  }

  async #openStore(
    alias: string,
    operation: string,
  ): Promise<ResultType<TypedStore, TransferError>> {
    const handle = this.#stores[alias];
    if (!handle) {
      return Result.err(
        new TransferError({
          operation,
          context: { reason: "unknown_store", store: alias },
        }),
      );
    }

    const store = await handle.open();
    const value = store.take();
    if (isErr(value)) {
      return Result.err(
        new TransferError({
          operation,
          cause: value.error,
          context: { store: alias },
        }),
      );
    }
    return Result.ok(value);
  }

  async #flushSubscriptionInterest(
    operation: string,
  ): Promise<ResultType<void, TransferError>> {
    try {
      await this.#nc.flush();
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(new TransferError({ operation, cause }));
    }
  }

  async #runUploadSession(session: UploadSession): Promise<void> {
    try {
      for await (const msg of session.subscription) {
        await this.#handleUploadMessage(session, msg);
        if (!this.#uploadSessions.has(session.subject)) {
          break;
        }
      }
    } finally {
      this.#cleanupUploadSession(session.subject);
    }
  }

  async #handleUploadMessage(session: UploadSession, msg: Msg): Promise<void> {
    if (Date.now() >= session.expiresAtMs) {
      const error = new TransferError({
        operation: "put",
        context: { reason: "expired" },
      });
      replyError(msg, error);
      this.#expireUploadSession(session.subject, error);
      return;
    }

    const authenticated = await verifyTransferMessage({
      expectedSessionKey: session.sessionKey,
      subject: msg.subject,
      payload: msg.data,
      proof: msg.headers?.get("proof"),
      sessionKey: msg.headers?.get("session-key"),
    });
    if (!authenticated) {
      const error = new TransferError({
        operation: "put",
        context: { reason: "invalid_proof" },
      });
      replyError(msg, error);
      this.#expireUploadSession(session.subject, error);
      return;
    }

    const seq = parseSeq(msg).take();
    if (isErr(seq)) {
      replyError(msg, seq.error);
      this.#expireUploadSession(session.subject, seq.error);
      return;
    }
    if (seq !== session.nextSeq) {
      const error = new TransferError({
        operation: "put",
        context: {
          reason: "out_of_order",
          expected: session.nextSeq,
          actual: seq,
        },
      });
      replyError(msg, error);
      this.#expireUploadSession(session.subject, error);
      return;
    }
    if (msg.data.length > 0) {
      if (msg.data.length > this.#chunkBytes) {
        const error = new TransferError({
          operation: "put",
          context: {
            reason: "chunk_too_large",
            maxChunkBytes: this.#chunkBytes,
          },
        });
        replyError(msg, error);
        this.#expireUploadSession(session.subject, error);
        return;
      }
      session.receivedBytes += msg.data.length;
      if (
        session.maxBytes !== undefined &&
        session.receivedBytes > session.maxBytes
      ) {
        const error = new TransferError({
          operation: "put",
          context: {
            reason: "max_bytes_exceeded",
            maxBytes: session.maxBytes,
            attemptedBytes: session.receivedBytes,
          },
        });
        replyError(msg, error);
        this.#expireUploadSession(session.subject, error);
        return;
      }
      session.queue.push(msg.data);
      await session.onProgress?.({
        chunkIndex: session.nextSeq,
        chunkBytes: msg.data.length,
        transferredBytes: session.receivedBytes,
      });
    }
    session.nextSeq += 1;

    if (msg.headers?.get(TRANSFER_EOF_HEADER) === "true") {
      session.queue.close();
      const putResult = await session.putPromise;
      const putValue = putResult.take();
      if (isErr(putValue)) {
        const error = new TransferError({
          operation: "put",
          cause: putValue.error,
        });
        replyError(msg, error);
        this.#expireUploadSession(session.subject, error);
        return;
      }

      const stored = await session.store.get(session.key);
      const storedValue = stored.take();
      if (isErr(storedValue)) {
        const error = new TransferError({
          operation: "put",
          cause: storedValue.error,
        });
        replyError(msg, error);
        this.#expireUploadSession(session.subject, error);
        return;
      }

      const info = fileInfoFromStoreInfo(storedValue.info);
      msg.respond(JSON.stringify({ status: "complete", info }));
      await session.onComplete?.(info);
      if (session.onStored) {
        void Promise.resolve(session.onStored({
          transferId: session.transferId,
          sessionKey: session.sessionKey,
          store: session.store,
          entry: storedValue,
          info,
        })).catch((error) => {
          console.error("transfer onStored callback failed", error);
        });
      }
      this.#cleanupUploadSession(session.subject);
      return;
    }

    msg.respond(JSON.stringify({ status: "continue" }));
  }

  async #runDownloadSession(session: DownloadSession): Promise<void> {
    try {
      for await (const msg of session.subscription) {
        await this.#handleDownloadRequest(session, msg);
        break;
      }
    } finally {
      this.#cleanupDownloadSession(session.subject);
    }
  }

  async #handleDownloadRequest(
    session: DownloadSession,
    msg: Msg,
  ): Promise<void> {
    const reply = msg.reply;
    if (
      !reply || !reply.startsWith(`_INBOX.${session.sessionKey.slice(0, 16)}.`)
    ) {
      replyError(
        msg,
        new TransferError({
          operation: "get",
          context: { reason: "reply_subject_mismatch" },
        }),
      );
      return;
    }
    if (Date.now() >= session.expiresAtMs) {
      publishError(
        this.#nc,
        reply,
        new TransferError({ operation: "get", context: { reason: "expired" } }),
      );
      return;
    }

    const authenticated = await verifyTransferMessage({
      expectedSessionKey: session.sessionKey,
      subject: msg.subject,
      payload: msg.data,
      proof: msg.headers?.get("proof"),
      sessionKey: msg.headers?.get("session-key"),
    });
    if (!authenticated) {
      publishError(
        this.#nc,
        reply,
        new TransferError({
          operation: "get",
          context: { reason: "invalid_proof" },
        }),
      );
      return;
    }

    const entry = await session.store.get(session.key);
    const entryValue = entry.take();
    if (isErr(entryValue)) {
      publishError(
        this.#nc,
        reply,
        new TransferError({ operation: "get", cause: entryValue.error }),
      );
      return;
    }

    const stream = await entryValue.stream();
    const streamValue = stream.take();
    if (isErr(streamValue)) {
      publishError(
        this.#nc,
        reply,
        new TransferError({ operation: "get", cause: streamValue.error }),
      );
      return;
    }

    let seq = 0;
    try {
      for await (const chunk of iterateStream(streamValue)) {
        const headers = natsHeaders();
        headers.set(TRANSFER_SEQUENCE_HEADER, String(seq));
        this.#nc.publish(reply, chunk, { headers });
        seq += 1;
      }
      const finalHeaders = natsHeaders();
      finalHeaders.set(TRANSFER_SEQUENCE_HEADER, String(seq));
      finalHeaders.set(TRANSFER_EOF_HEADER, "true");
      this.#nc.publish(reply, new Uint8Array(), { headers: finalHeaders });
      await this.#nc.flush();
    } catch (cause) {
      publishError(
        this.#nc,
        reply,
        new TransferError({ operation: "get", cause }),
      );
    }
  }

  #expireUploadSession(
    subject: string,
    error = new TransferError({
      operation: "put",
      context: { reason: "expired" },
    }),
  ): void {
    const session = this.#uploadSessions.get(subject);
    if (!session) {
      return;
    }
    session.queue.fail(error);
    void Promise.resolve(session.onError?.(error));
    this.#cleanupUploadSession(subject);
  }

  #cleanupUploadSession(subject: string): void {
    const session = this.#uploadSessions.get(subject);
    if (!session) {
      return;
    }
    clearTimeout(session.timeoutId);
    session.subscription.unsubscribe();
    this.#uploadSessions.delete(subject);
  }

  #cleanupDownloadSession(subject: string): void {
    const session = this.#downloadSessions.get(subject);
    if (!session) {
      return;
    }
    clearTimeout(session.timeoutId);
    session.subscription.unsubscribe();
    this.#downloadSessions.delete(subject);
  }
}
