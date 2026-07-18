/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_MAP_STYLE_URL: string;
  readonly VITE_DEPARTMENT_NAME: string;
  readonly VITE_DEPARTMENT_TZ: string;
  readonly VITE_MAX_CONCURRENT_STREAMS: string;
  readonly VITE_RETENTION_DAYS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
