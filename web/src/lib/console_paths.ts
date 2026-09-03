import { base as siteBase } from "$app/paths";

export const base = `${siteBase}/console`;

/** Resolves a Console-local route beneath the unified web application's prefix. */
export function resolve(
  route: string,
  params: Record<string, string> = {},
): string {
  let path = route.replace("/(app)", "");
  for (const [name, value] of Object.entries(params)) {
    path = path.replace(`[${name}]`, encodeURIComponent(value));
  }
  return `${base}${path === "/" ? "" : path}`;
}
