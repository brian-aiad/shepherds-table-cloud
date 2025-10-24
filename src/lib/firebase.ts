// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

/* ========= Small runtime guard + logger ========= */
const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  // appId is required if you created the app in console with it
  'VITE_FIREBASE_APP_ID',
] as const;

function checkEnv() {
  const missing = required.filter((k) => !import.meta.env[k]);
  if (missing.length) {
    // Surface clear error with which keys are missing
    console.error(
      '[firebase] Missing required env keys:',
      missing.join(', '),
      '\nMake sure your .env is populated or .env.example was copied correctly.'
    );
  }
}

function buildConfig() {
  // messagingSenderId is optional; include it only if present to avoid empty-string warnings
  const cfg: Record<string, string> = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  if (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) {
    cfg.messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  }
  return cfg;
}

/* ========= Initialize exactly once ========= */
checkEnv();

let app: FirebaseApp;
try {
  app = getApps().length ? getApp() : initializeApp(buildConfig());
  if (import.meta.env.DEV) {
    // Collapsed group keeps console tidy in Vite HMR
    // eslint-disable-next-line no-console
    console.groupCollapsed('[firebase] initialized');
    // eslint-disable-next-line no-console
    console.log('apps:', getApps().map((a) => a.name));
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
} catch (err) {
  console.error('[firebase] Failed to initialize:', err);
  throw err; // rethrow so the app fails fast and visibly
}

/* ========= Typed singletons ========= */
let _auth: Auth | undefined;
let _db: Firestore | undefined;
let _storage: FirebaseStorage | undefined;

export const auth = (() => (_auth ??= getAuth(app)))();
export const db = (() => (_db ??= getFirestore(app)))();
export const storage = (() => (_storage ??= getStorage(app)))();
export { app };
