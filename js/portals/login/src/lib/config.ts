import { env } from "$env/dynamic/public";

const DEFAULT_TRELLIS_URL = "http://localhost:3000";

function requirePublicTrellisUrl(): string {
  const value = env.PUBLIC_TRELLIS_URL?.trim() || DEFAULT_TRELLIS_URL;

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch (error) {
    throw new Error(
      `Invalid PUBLIC_TRELLIS_URL ${JSON.stringify(value)}: ${
        (error as Error).message
      }`,
    );
  }
}

export const trellisUrl = requirePublicTrellisUrl();
