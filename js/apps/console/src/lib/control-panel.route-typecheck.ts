import type { AppTypes } from "$app/types";
import { routeTitles } from "./control-panel.ts";

type AppPathname = ReturnType<AppTypes["Pathname"]>;

function checkRouteTitles<T extends Partial<Record<AppPathname, string>>>(
  titles: T & Record<Exclude<keyof T, AppPathname>, never>,
): void {
  void titles;
}

checkRouteTitles(routeTitles);
