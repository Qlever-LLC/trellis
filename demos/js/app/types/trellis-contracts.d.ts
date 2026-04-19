declare module "@qlever-llc/trellis/contracts" {
  export type InferSchemaType<T> = T extends { __type?: infer U } ? U : unknown;
  export type TrellisAPI = {
    rpc: Record<string, unknown>;
    operations: Record<string, unknown>;
    events: Record<string, unknown>;
    subjects: Record<string, unknown>;
  };

  export function schema<T>(value: unknown): T;

  export function defineAppContract<T>(builder: () => T): T & {
    CONTRACT: unknown;
    CONTRACT_DIGEST: string;
    API: {
      trellis: {
        rpc: Record<string, unknown>;
        operations: Record<string, unknown>;
        events: Record<string, unknown>;
        subjects: Record<string, unknown>;
      };
    };
  };
}
