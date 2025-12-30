// Global type declarations for Window interface

import type { IOSAudioHandler } from './index';

declare global {
  interface Window {
    iosAudioHandler?: IOSAudioHandler;
  }
}

export {};
