// Build flavour. The phone app (`npm run build:ios`) is built with VITE_STANDALONE=1: it ships
// every file inside the app and has no server, so the mock Intelehealth sync, the server-side
// AI provider and the service worker are switched off instead of failing in confusing ways.
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

export const NO_SERVER = 'no server in the phone build; this record stays on this device';
