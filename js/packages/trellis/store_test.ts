import { assertEquals } from "@std/assert";

import {
  type StoreInfo,
  type StoreListOptions,
  type StorePutOptions,
  type StoreStatus,
  type StoreWaitOptions,
} from "./store.ts";
import type { PageResponse } from "./models/trellis/Page.ts";

Deno.test("Store public types compile", () => {
  const _putOptions: StorePutOptions = {
    contentType: "application/pdf",
    metadata: { source: "portal" },
  };

  const _info: StoreInfo = {
    key: "incoming/test.pdf",
    size: 123,
    updatedAt: new Date().toISOString(),
    digest: "sha256:test",
    contentType: "application/pdf",
    metadata: { source: "portal" },
  };

  const _status: StoreStatus = {
    size: 123,
    sealed: false,
    ttlMs: 60_000,
    maxObjectBytes: 1024,
    maxTotalBytes: 4096,
  };

  const _waitOptions: StoreWaitOptions = {
    timeoutMs: 5_000,
    pollIntervalMs: 100,
    signal: new AbortController().signal,
  };

  const _listOptions: StoreListOptions = {
    prefix: "incoming/",
    offset: 0,
    limit: 10,
  };
  const _listPage: PageResponse<StoreInfo> = {
    entries: [_info],
    count: 1,
    offset: 0,
    limit: 10,
    nextOffset: 10,
  };

  assertEquals(true, true);
});
