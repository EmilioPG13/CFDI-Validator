/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Phase 5 backend (Express, separate origin from this frontend --
   *  Render in production, http://localhost:3001 in dev). See src/lib/backendApi.ts. */
  readonly VITE_BACKEND_URL?: string;
  /** Must match backend/.env's INTERNAL_DRAIN_TOKEN. See src/lib/backendApi.ts's own
   *  comment on why this is meant to ship in a public bundle. */
  readonly VITE_INTERNAL_DRAIN_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
