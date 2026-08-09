/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Phase 5 backend (Express, separate origin from this frontend --
   *  Render in production, http://localhost:3001 in dev). See src/lib/backendApi.ts. */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
