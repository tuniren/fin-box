/// <reference types="vite/client" />

import type { FinBoxApi } from "./shared/types";

declare global {
  interface Window {
    finBox: FinBoxApi;
  }
}
