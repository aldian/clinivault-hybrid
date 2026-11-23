import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import {
  fetchAndActivate,
  getBoolean,
  getNumber,
  getRemoteConfig,
  getString,
} from "firebase/remote-config";
import type { RemotePolicy } from "../types";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

let appCheckInstance: AppCheck | null = null;
let appCheckMode: "debug" | "recaptcha" | "unconfigured" = "unconfigured";

/**
 * Initialize App Check cleanly for local debugging and hosted validation without
 * crashing offline local AI flows if production reCAPTCHA is not yet attached.
 */
function initAppCheckSafely(): void {
  if (typeof window === "undefined") return;
  const envDebugToken = (import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || "").trim();
  const recaptchaSiteKey = (import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY || "").trim();
  const isLocalHost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const hasExplicitDebugUuid = Boolean(envDebugToken && envDebugToken !== "true");

  try {
    if (hasExplicitDebugUuid) {
      const globalSelf = self as unknown as Record<string, unknown>;
      globalSelf.FIREBASE_APPCHECK_DEBUG_TOKEN = envDebugToken;
      appCheckMode = "debug";
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(
          recaptchaSiteKey || "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
        ),
        isTokenAutoRefreshEnabled: true,
      });
      return;
    }

    if (isLocalHost) {
      const globalSelf = self as unknown as Record<string, unknown>;
      globalSelf.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      appCheckMode = "debug";
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(
          recaptchaSiteKey || "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
        ),
        isTokenAutoRefreshEnabled: true,
      });
      return;
    }

    if (recaptchaSiteKey) {
      appCheckMode = "recaptcha";
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }
  } catch {
    appCheckInstance = null;
  }
}

initAppCheckSafely();

export function getAppCheckState(): { enabled: boolean; mode: "debug" | "recaptcha" | "unconfigured" } {
  return {
    enabled: Boolean(appCheckInstance),
    mode: appCheckMode,
  };
}

export const ai = getAI(app, { backend: new GoogleAIBackend() });

export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const remoteConfig = getRemoteConfig(app);
remoteConfig.settings.minimumFetchIntervalMillis = 300_000;
remoteConfig.defaultConfig = {
  cloud_model_name: "gemini-3.5-flash-lite",
  fast_cloud_model_name: "gemini-3.5-flash-lite",
  default_triage_mode: "PREFER_ON_DEVICE",
  max_cloud_output_tokens: 2048,
  enable_cloud_synthesis: true,
};

export async function loadRemotePolicy(): Promise<RemotePolicy> {
  let fetched = false;
  try {
    fetched = await fetchAndActivate(remoteConfig);
  } catch {
    fetched = false;
  }
  const rawMode = getString(remoteConfig, "default_triage_mode");
  return {
    cloudModelName: getString(remoteConfig, "cloud_model_name") || "gemini-3.5-flash-lite",
    fastCloudModelName: getString(remoteConfig, "fast_cloud_model_name") || "gemini-3.5-flash-lite",
    defaultTriageMode: rawMode === "ONLY_ON_DEVICE" ? "ONLY_ON_DEVICE" : "PREFER_ON_DEVICE",
    maxCloudOutputTokens: Math.max(512, Math.min(4096, getNumber(remoteConfig, "max_cloud_output_tokens") || 2048)),
    enableCloudSynthesis: getBoolean(remoteConfig, "enable_cloud_synthesis"),
    source: fetched ? "remote" : "default",
  };
}
