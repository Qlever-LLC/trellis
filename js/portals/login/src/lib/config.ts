import { PUBLIC_TRELLIS_URL } from "$env/static/public";

function requirePublicTrellisUrl(): string {
  const value = PUBLIC_TRELLIS_URL?.trim();
  if (!value) {
    throw new Error(
      "Missing PUBLIC_TRELLIS_URL. Set it in js/portals/login/.env, shell env, or the Trellis service portal build step.",
    );
  }

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch (error) {
    throw new Error(
      `Invalid PUBLIC_TRELLIS_URL ${JSON.stringify(value)}: ${(error as Error).message}`,
    );
  }
}

export const trellisUrl = requirePublicTrellisUrl();
