import type { LodeApi } from './api';

declare global {
  interface Window {
    lode: LodeApi;
  }
}
