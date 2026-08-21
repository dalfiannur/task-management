// App-wide display config sourced from build-time env (Vite `import.meta.env`).
//
// The app name is configurable via `VITE_APP_NAME`. Keep the fallback in sync
// with DEFAULT_APP_NAME in vite.config.ts (used for the <title>, which is plain
// HTML and can't read this module).

export const DEFAULT_APP_NAME = "Project Management";

/** Product name shown in the header, auth screens, and document title. */
export const APP_NAME: string =
  import.meta.env.VITE_APP_NAME?.trim() || DEFAULT_APP_NAME;
