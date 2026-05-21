import { browser } from "$app/environment";

export type GuidesTheme = "trellis" | "trellis-dark";

const STORAGE_KEY = "trellis.guides.theme";

function isGuidesTheme(value: string | null): value is GuidesTheme {
  return value === "trellis" || value === "trellis-dark";
}

function systemTheme(): GuidesTheme {
  if (!browser) return "trellis";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "trellis-dark"
    : "trellis";
}

function readSavedTheme(): GuidesTheme | null {
  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    return isGuidesTheme(savedTheme) ? savedTheme : null;
  } catch {
    return null;
  }
}

function saveTheme(theme: GuidesTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Theme persistence is optional; blocked storage should not break docs.
  }
}

class GuidesThemeState {
  #state = $state<{ theme: GuidesTheme }>({ theme: "trellis" });

  get theme(): GuidesTheme {
    return this.#state.theme;
  }

  get darkMode(): boolean {
    return this.#state.theme === "trellis-dark";
  }

  /** Applies the saved guides theme to the document root. */
  init(): void {
    if (!browser) return;

    this.setTheme(readSavedTheme() ?? systemTheme(), {
      persist: false,
    });
  }

  /** Switches between the light and dark Trellis guides themes. */
  toggle(): void {
    this.setTheme(this.darkMode ? "trellis" : "trellis-dark");
  }

  /** Sets the active Trellis guides theme. */
  setTheme(theme: GuidesTheme, options: { persist?: boolean } = {}): void {
    this.#state.theme = theme;
    if (!browser) return;

    document.documentElement.setAttribute("data-theme", theme);
    if (options.persist !== false) {
      saveTheme(theme);
    }
  }
}

/** Shared theme state for the guides app. */
export const guidesTheme = new GuidesThemeState();
