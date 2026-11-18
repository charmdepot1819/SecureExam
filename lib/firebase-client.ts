"use client";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";

/** Browser-side Firebase, used only for signing in. All data access goes through the server. */
let auth: Auth | null = null;

export function clientAuth(): Auth {
  if (auth) return auth;
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  auth = getAuth(app);
  const emu = process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST;
  if (emu) connectAuthEmulator(auth, `http://${emu}`, { disableWarnings: true });
  return auth;
}
