export type CalloutLimiterOptions = {
  maxConcurrent: number;
  maxQueue: number;
  maxConcurrentPerIp: number;
  maxConcurrentPerServer: number;
};

export type CalloutContext = {
  ip?: string;
  server?: string;
};

type Release = () => void;

type Waiter = {
  ctx: CalloutContext;
  resolve: (release: Release) => void;
};

function inc(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function dec(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

export class CalloutLimiter {
  readonly #maxConcurrent: number;
  readonly #maxQueue: number;
  readonly #maxConcurrentPerIp: number;
  readonly #maxConcurrentPerServer: number;

  #inFlight = 0;
  readonly #inFlightByIp = new Map<string, number>();
  readonly #inFlightByServer = new Map<string, number>();
  readonly #waiters: Array<Waiter> = [];

  constructor(options: CalloutLimiterOptions) {
    this.#maxConcurrent = options.maxConcurrent;
    this.#maxQueue = options.maxQueue;
    this.#maxConcurrentPerIp = options.maxConcurrentPerIp;
    this.#maxConcurrentPerServer = options.maxConcurrentPerServer;
  }

  async acquire(ctx: CalloutContext): Promise<Release | null> {
    const immediate = this.#tryAcquire(ctx);
    if (immediate) return immediate;

    if (this.#waiters.length >= this.#maxQueue) return null;

    return await new Promise<Release>((resolve) => {
      this.#waiters.push({ ctx, resolve });
    });
  }

  #tryAcquire(ctx: CalloutContext): Release | null {
    if (this.#inFlight >= this.#maxConcurrent) return null;

    if (ctx.ip) {
      const current = this.#inFlightByIp.get(ctx.ip) ?? 0;
      if (current >= this.#maxConcurrentPerIp) return null;
    }

    if (ctx.server) {
      const current = this.#inFlightByServer.get(ctx.server) ?? 0;
      if (current >= this.#maxConcurrentPerServer) return null;
    }

    this.#inFlight++;
    if (ctx.ip) inc(this.#inFlightByIp, ctx.ip);
    if (ctx.server) inc(this.#inFlightByServer, ctx.server);

    let released = false;
    return () => {
      if (released) return;
      released = true;

      this.#inFlight--;
      if (ctx.ip) dec(this.#inFlightByIp, ctx.ip);
      if (ctx.server) dec(this.#inFlightByServer, ctx.server);

      this.#drain();
    };
  }

  #drain(): void {
    if (this.#waiters.length === 0) return;

    for (let i = 0; i < this.#waiters.length;) {
      const waiter = this.#waiters[i];
      const release = this.#tryAcquire(waiter.ctx);
      if (!release) {
        i++;
        continue;
      }

      this.#waiters.splice(i, 1);
      waiter.resolve(release);
      // don't increment i; we removed current element
    }
  }
}
