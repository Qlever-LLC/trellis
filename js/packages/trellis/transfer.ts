import { AsyncResult, isErr, Result, type Result as ResultType } from "@qlever-llc/result";
import { createInbox, headers as natsHeaders, type Msg, type MsgHdrs, type NatsConnection } from "@nats-io/nats-core";
import Type, { type Static } from "typebox";
import { verifyProof } from "../auth/proof.ts";
import { base64urlEncode, sha256 } from "../auth/utils.ts";
import { TransferError } from "./errors/TransferError.ts";

const TRANSFER_SEQUENCE_HEADER = "trellis-transfer-seq";
const TRANSFER_EOF_HEADER = "trellis-transfer-eof";

export const FileInfoSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 0 }),
  updatedAt: Type.String({ minLength: 1 }),
  digest: Type.Optional(Type.String({ minLength: 1 })),
  contentType: Type.Optional(Type.String({ minLength: 1 })),
  metadata: Type.Record(Type.String({ minLength: 1 }), Type.String()),
}, { additionalProperties: false });

export type FileInfo = Static<typeof FileInfoSchema>;

const TransferGrantBaseSchema = Type.Object({
  type: Type.Literal("TransferGrant"),
  service: Type.String({ minLength: 1 }),
  sessionKey: Type.String({ minLength: 1 }),
  transferId: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1 }),
  expiresAt: Type.String({ minLength: 1 }),
  chunkBytes: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const UploadTransferGrantSchema = Type.Intersect([
  TransferGrantBaseSchema,
  Type.Object({
    kind: Type.Literal("upload"),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1 })),
    contentType: Type.Optional(Type.String({ minLength: 1 })),
    metadata: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
  }, { additionalProperties: false }),
]);

export const DownloadTransferGrantSchema = Type.Intersect([
  TransferGrantBaseSchema,
  Type.Object({
    kind: Type.Literal("download"),
    info: FileInfoSchema,
  }, { additionalProperties: false }),
]);

export const TransferGrantSchema = Type.Union([
  UploadTransferGrantSchema,
  DownloadTransferGrantSchema,
]);

export type UploadTransferGrant = Static<typeof UploadTransferGrantSchema>;
export type DownloadTransferGrant = Static<typeof DownloadTransferGrantSchema>;
export type TransferGrant = Static<typeof TransferGrantSchema>;

export type TransferBody =
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

type TrellisTransferAuth = {
  sessionKey: string;
  sign(data: Uint8Array): Promise<Uint8Array> | Uint8Array;
};

type TransferAck =
  | { status: "continue" }
  | { status: "complete"; info: FileInfo };

async function createTransferProof(
  auth: TrellisTransferAuth,
  subject: string,
  payload: Uint8Array,
): Promise<string> {
  const payloadHash = await sha256(payload);
  const proofOk = await auth.sign(await sha256(buildTransferProofInput(auth.sessionKey, subject, payloadHash)));
  return base64urlEncode(proofOk);
}

function buildTransferProofInput(
  sessionKey: string,
  subject: string,
  payloadHash: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const sessionKeyBytes = enc.encode(sessionKey);
  const subjectBytes = enc.encode(subject);
  const buf = new Uint8Array(4 + sessionKeyBytes.length + 4 + subjectBytes.length + 4 + payloadHash.length);
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

function expired(expiresAt: string): boolean {
  return Date.now() >= Date.parse(expiresAt);
}

function asUint8Array(body: Uint8Array | ArrayBuffer): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}

function streamFromAsyncIterable(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

function streamFromBody(body: TransferBody): ReadableStream<Uint8Array> {
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    const bytes = asUint8Array(body);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
  return body instanceof ReadableStream ? body : streamFromAsyncIterable(body);
}

async function* chunkBody(body: TransferBody, chunkBytes: number): AsyncIterable<Uint8Array> {
  const reader = streamFromBody(body).getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return;
      }

      let offset = 0;
      while (offset < next.value.length) {
        const end = Math.min(offset + chunkBytes, next.value.length);
        yield next.value.slice(offset, end);
        offset = end;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseTransferAck(msg: Msg, operation: string): ResultType<TransferAck, TransferError> {
  if (msg.headers?.get("status") === "error") {
    return Result.err(deserializeTransferError(msg, operation));
  }

  try {
    const value = JSON.parse(msg.string()) as TransferAck;
    return Result.ok(value);
  } catch (cause) {
    return Result.err(new TransferError({ operation, cause }));
  }
}

function deserializeTransferError(msg: Msg, operation: string): TransferError {
  try {
    const value = JSON.parse(msg.string()) as { message?: string; operation?: string; context?: Record<string, unknown> };
    return new TransferError({
      operation: value.operation ?? operation,
      context: value.context,
      cause: value.message ? new Error(value.message) : undefined,
    });
  } catch (cause) {
    return new TransferError({ operation, cause });
  }
}

async function collectDownload(
  nc: NatsConnection,
  inbox: string,
  timeoutMs: number,
): Promise<ResultType<Uint8Array, TransferError>> {
  const sub = nc.subscribe(inbox);
  const iterator = sub[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const next = await new Promise<IteratorResult<Msg>>((resolve, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new TransferError({ operation: "get", context: { reason: "timeout" } }));
        }, timeoutMs);

        iterator.next().then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });

      if (next.done) {
        return Result.err(new TransferError({ operation: "get", context: { reason: "stream_closed" } }));
      }

      const msg = next.value;
      if (msg.headers?.get("status") === "error") {
        return Result.err(deserializeTransferError(msg, "get"));
      }

      if (msg.data.length > 0) {
        chunks.push(msg.data);
        total += msg.data.length;
      }

      if (msg.headers?.get(TRANSFER_EOF_HEADER) === "true") {
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        return Result.ok(merged);
      }
    }
  } catch (cause) {
    return Result.err(cause instanceof TransferError ? cause : new TransferError({ operation: "get", cause }));
  } finally {
    sub.unsubscribe();
  }
}

class BaseTransferHandle {
  readonly #nc: NatsConnection;
  readonly #auth: TrellisTransferAuth;
  readonly #timeoutMs: number;

  protected constructor(nc: NatsConnection, auth: TrellisTransferAuth, timeoutMs: number) {
    this.#nc = nc;
    this.#auth = auth;
    this.#timeoutMs = timeoutMs;
  }

  protected get nc(): NatsConnection {
    return this.#nc;
  }

  protected get auth(): TrellisTransferAuth {
    return this.#auth;
  }

  protected get timeoutMs(): number {
    return this.#timeoutMs;
  }

  protected validateGrant(grant: TransferGrant, operation: string): ResultType<void, TransferError> {
    if (expired(grant.expiresAt)) {
      return Result.err(new TransferError({ operation, context: { reason: "expired", transferId: grant.transferId } }));
    }
    if (grant.sessionKey !== this.#auth.sessionKey) {
      return Result.err(
        new TransferError({
          operation,
          context: {
            reason: "session_mismatch",
            expectedSessionKey: grant.sessionKey,
            actualSessionKey: this.#auth.sessionKey,
          },
        }),
      );
    }
    return Result.ok(undefined);
  }

  protected async buildHeaders(subject: string, payload: Uint8Array, seq?: number, eof?: boolean): Promise<MsgHdrs> {
    const headers = natsHeaders();
    headers.set("session-key", this.#auth.sessionKey);
    headers.set("proof", await createTransferProof(this.#auth, subject, payload));
    if (seq !== undefined) {
      headers.set(TRANSFER_SEQUENCE_HEADER, String(seq));
    }
    if (eof) {
      headers.set(TRANSFER_EOF_HEADER, "true");
    }
    return headers;
  }
}

export class UploadTransferHandle extends BaseTransferHandle {
  readonly #grant: UploadTransferGrant;

  constructor(nc: NatsConnection, auth: TrellisTransferAuth, timeoutMs: number, grant: UploadTransferGrant) {
    super(nc, auth, timeoutMs);
    this.#grant = grant;
  }

  async put(body: TransferBody): Promise<ResultType<FileInfo, TransferError>> {
    const valid = this.validateGrant(this.#grant, "put").take();
    if (isErr(valid)) {
      return Result.err(valid.error);
    }

    let sentBytes = 0;
    let seq = 0;
    let completed: FileInfo | null = null;

    for await (const chunk of chunkBody(body, this.#grant.chunkBytes)) {
      sentBytes += chunk.length;
      if (this.#grant.maxBytes !== undefined && sentBytes > this.#grant.maxBytes) {
        return Result.err(new TransferError({
          operation: "put",
          context: {
            reason: "max_bytes_exceeded",
            maxBytes: this.#grant.maxBytes,
            attemptedBytes: sentBytes,
          },
        }));
      }

      const headers = await this.buildHeaders(this.#grant.subject, chunk, seq, false);
      const response = await AsyncResult.try(() =>
        this.nc.request(this.#grant.subject, chunk, { timeout: this.timeoutMs, headers })
      ).take();
      if (isErr(response)) {
        return Result.err(new TransferError({ operation: "put", cause: response.error }));
      }

      const ack = parseTransferAck(response, "put").take();
      if (isErr(ack)) {
        return Result.err(ack.error);
      }
      if (ack.status === "complete") {
        completed = ack.info;
      }
      seq += 1;
    }

    const finalHeaders = await this.buildHeaders(this.#grant.subject, new Uint8Array(), seq, true);
    const finalResponse = await AsyncResult.try(() =>
      this.nc.request(this.#grant.subject, new Uint8Array(), {
        timeout: this.timeoutMs,
        headers: finalHeaders,
      })
    ).take();
    if (isErr(finalResponse)) {
      return Result.err(new TransferError({ operation: "put", cause: finalResponse.error }));
    }

    const finalAck = parseTransferAck(finalResponse, "put").take();
    if (isErr(finalAck)) {
      return Result.err(finalAck.error);
    }
    if (finalAck.status !== "complete") {
      return Result.err(new TransferError({ operation: "put", context: { reason: "missing_completion" } }));
    }
    return Result.ok(finalAck.info ?? completed!);
  }
}

export class DownloadTransferHandle extends BaseTransferHandle {
  readonly #grant: DownloadTransferGrant;

  constructor(nc: NatsConnection, auth: TrellisTransferAuth, timeoutMs: number, grant: DownloadTransferGrant) {
    super(nc, auth, timeoutMs);
    this.#grant = grant;
  }

  async getBytes(): Promise<ResultType<Uint8Array, TransferError>> {
    const valid = this.validateGrant(this.#grant, "get").take();
    if (isErr(valid)) {
      return Result.err(valid.error);
    }

    const inbox = createInbox(`_INBOX.${this.auth.sessionKey.slice(0, 16)}`);
    const payload = new Uint8Array();
    const headers = await this.buildHeaders(this.#grant.subject, payload);

    try {
      this.nc.publish(this.#grant.subject, payload, { headers, reply: inbox });
      await this.nc.flush();
    } catch (cause) {
      return Result.err(new TransferError({ operation: "get", cause }));
    }

    return await collectDownload(this.nc, inbox, this.timeoutMs);
  }
}

export type TransferHandle = UploadTransferHandle | DownloadTransferHandle;

export function createTransferHandle(
  nc: NatsConnection,
  auth: TrellisTransferAuth,
  timeoutMs: number,
  grant: UploadTransferGrant,
): UploadTransferHandle;
export function createTransferHandle(
  nc: NatsConnection,
  auth: TrellisTransferAuth,
  timeoutMs: number,
  grant: DownloadTransferGrant,
): DownloadTransferHandle;
export function createTransferHandle(
  nc: NatsConnection,
  auth: TrellisTransferAuth,
  timeoutMs: number,
  grant: TransferGrant,
): TransferHandle;
export function createTransferHandle(
  nc: NatsConnection,
  auth: TrellisTransferAuth,
  timeoutMs: number,
  grant: TransferGrant,
): TransferHandle {
  return grant.kind === "upload"
    ? new UploadTransferHandle(nc, auth, timeoutMs, grant)
    : new DownloadTransferHandle(nc, auth, timeoutMs, grant);
}

export async function verifyTransferMessage(args: {
  expectedSessionKey: string;
  subject: string;
  payload: Uint8Array;
  proof?: string | null;
  sessionKey?: string | null;
}): Promise<boolean> {
  if (!args.proof || !args.sessionKey || args.sessionKey !== args.expectedSessionKey) {
    return false;
  }

  return await verifyProof(args.expectedSessionKey, {
    sessionKey: args.sessionKey,
    subject: args.subject,
    payloadHash: await sha256(args.payload),
  }, args.proof);
}
