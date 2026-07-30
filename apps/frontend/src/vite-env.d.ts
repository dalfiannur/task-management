/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Product name shown in the UI. Falls back to DEFAULT_APP_NAME when unset. */
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
