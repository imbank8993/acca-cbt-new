import type { ToastAPI } from './toast';

declare global {
  interface Window {
    __TOAST_PROVIDER__?: ToastAPI;
  }
}

export {};