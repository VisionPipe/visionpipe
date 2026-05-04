/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_VP_EDGE_HTTP?: string;
  readonly VITE_VP_EDGE_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
