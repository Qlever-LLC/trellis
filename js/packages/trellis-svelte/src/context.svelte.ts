import type {
  RequestOpts,
  RuntimeStateStoresForContract,
  StateFacade,
  TrellisAPI,
  TrellisConnection,
  TrellisConnectionStatus,
  TrellisContractV1,
} from "@qlever-llc/trellis";
import type { AsyncResult, BaseError, MaybeAsync } from "@qlever-llc/result";
import { createContext } from "svelte";
import { createSubscriber } from "svelte/reactivity";

/** Minimal contract shape required to create a typed Trellis Svelte app context. */
export type TrellisContractLike<TA extends TrellisAPI = TrellisAPI> = {
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: {
    trellis: TA;
  };
};

type EventCallback<TMessage> = {
  bivarianceHack(message: TMessage): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

/** Real connected Trellis client type exposed by a Svelte app context. */
export type TrellisClientFor<TContract extends TrellisContractLike> =
  & ConnectedTrellisRuntime
  & {
    readonly api: TContract["API"]["trellis"];
    readonly state: StateFacade<RuntimeStateStoresForContract<TContract>>;
    request<TOutput = unknown>(
      method: string,
      input: unknown,
      opts?: RequestOpts,
    ): AsyncResult<TOutput, BaseError>;
    event<TMessage = unknown>(
      event: string,
      subjectData: Record<string, unknown>,
      fn: EventCallback<TMessage>,
      opts?: {
        mode?: "ephemeral" | "durable";
        replay?: "new" | "all";
        signal?: AbortSignal;
      },
    ): AsyncResult<void, BaseError>;
    wait(): AsyncResult<void, BaseError>;
  };

/** Minimal connected runtime surface needed by the Svelte provider. */
export type ConnectedTrellisRuntime = {
  readonly connection: TrellisConnection;
};

/** Svelte-reactive adapter around a framework-neutral Trellis connection. */
export class SvelteTrellisConnection {
  #connection: TrellisConnection;
  #subscribe: () => void;

  /** Creates a reactive connection adapter for a connected Trellis runtime. */
  constructor(connection: TrellisConnection) {
    this.#connection = connection;
    this.#subscribe = createSubscriber((update) => {
      return this.#connection.subscribe(() => update());
    });
  }

  /** Latest connection status, reactive when read by Svelte effects or markup. */
  get status(): TrellisConnectionStatus {
    this.#subscribe();
    return this.#connection.status;
  }

  /** Closes the underlying Trellis runtime connection. */
  close(): Promise<void> {
    return this.#connection.close();
  }
}

type TrellisAppContext<TContract extends TrellisContractLike> = {
  trellis: ConnectedTrellisRuntime;
  connection: SvelteTrellisConnection;
};

const provideTrellisContext = Symbol("provideTrellisContext");

/** Public app-scoped typed Svelte context owner for a Trellis browser app. */
export interface TrellisApp<
  TContract extends TrellisContractLike = TrellisContractLike,
> {
  /** Contract used by this app context and by `TrellisProvider` connections. */
  readonly contract: TContract;

  /** Returns the real connected Trellis client from Svelte context synchronously. */
  getTrellis<TClient = TrellisClientFor<TContract>>(): TClient;

  /** Returns a Svelte-reactive adapter for the real Trellis connection. */
  getConnection(): SvelteTrellisConnection;
}

/** Internal app-scoped typed Svelte context implementation. */
class TrellisAppImpl<
  TContract extends TrellisContractLike = TrellisContractLike,
> {
  readonly #contract: TContract;
  readonly #getContext: () => TrellisAppContext<TContract>;
  readonly #setContext: (
    context: TrellisAppContext<TContract>,
  ) => TrellisAppContext<TContract>;

  /** Creates an app-scoped context owner for a specific Trellis contract. */
  constructor(contract: TContract) {
    this.#contract = contract;
    const [getContext, setContext] = createContext<
      TrellisAppContext<TContract>
    >();
    this.#getContext = getContext;
    this.#setContext = setContext;
  }

  /** Contract used by this app context and by `TrellisProvider` connections. */
  get contract(): TContract {
    return this.#contract;
  }

  /** Returns the real connected Trellis client from Svelte context synchronously. */
  getTrellis<TClient = TrellisClientFor<TContract>>(): TClient {
    return this.#getContext().trellis as TClient;
  }

  /** Returns a Svelte-reactive adapter for the real Trellis connection. */
  getConnection(): SvelteTrellisConnection {
    return this.#getContext().connection;
  }

  /** Installs the connected Trellis runtime into Svelte context synchronously. */
  [provideTrellisContext](trellis: ConnectedTrellisRuntime): void {
    this.#setContext({
      trellis,
      connection: new SvelteTrellisConnection(trellis.connection),
    });
  }
}

/** Creates an app-scoped typed Svelte context owner for the given Trellis contract. */
export function createTrellisApp<TContract extends TrellisContractLike>(
  contract: TContract,
): TrellisApp<TContract> {
  return new TrellisAppImpl(contract);
}

/**
 * Internal provider helper that synchronously installs connected Trellis context.
 *
 * This is intentionally not exported from `src/index.ts`.
 */
export function provideConnectedTrellisContext(
  app: object,
  trellis: ConnectedTrellisRuntime,
): void {
  if (!(app instanceof TrellisAppImpl)) {
    throw new TypeError("Expected an app created by createTrellisApp");
  }
  app[provideTrellisContext](trellis);
}
