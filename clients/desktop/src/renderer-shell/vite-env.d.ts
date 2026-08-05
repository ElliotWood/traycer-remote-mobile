/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRAYCER_SIGN_IN_URL: string | undefined;
  readonly VITE_TRAYCER_OSS_REPO: string | undefined;
  readonly VITE_DEV_CLOUD_UI_BASE_URL: string | undefined;
  readonly VITE_DEV_DESKTOP_SLOT: string | undefined;
  /**
   * JSON array of `{hostId, websocketUrl, label?, version?}` merged into the
   * host picker. Declared here rather than relying on `vite/client`'s
   * `[key: string]: any` index signature - without an entry a typo in the
   * name reads as `any` and silently yields `undefined` forever.
   * Parsed by `extra-hosts.ts`.
   */
  readonly VITE_DESKTOP_EXTRA_HOSTS: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
