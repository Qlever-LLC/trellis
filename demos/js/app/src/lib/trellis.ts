import { env } from "$env/dynamic/public";

const value = env.PUBLIC_TRELLIS_URL?.trim() || "http://localhost:3000";

let trellisUrl: string;

try {
  trellisUrl = new URL(value).toString().replace(/\/$/, "");
} catch (error) {
  throw new Error(
    `Invalid PUBLIC_TRELLIS_URL ${JSON.stringify(value)}: ${
      (error as Error).message
    }`,
  );
}

export { trellisUrl };
