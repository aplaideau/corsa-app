// Abonnement aux notifications push de cet appareil.

export type PushPrefs = { prefs: Record<string, boolean>; lowBattery: number };
export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "insecure" | "not-installed" | "unsupported" | "denied" };

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  if (isIos() && !isStandalone()) return { ok: false, reason: "not-installed" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return { ok: false, reason: "unsupported" };
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  return { ok: true };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data as T;
}

function keyToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) || navigator.serviceWorker.register("/sw.js");
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupport().ok) return null;
  return (await registration()).pushManager.getSubscription();
}

export async function getTypes(): Promise<Record<string, string>> {
  const r = await fetch("/api/push/config", { credentials: "same-origin" });
  return (await r.json()).types;
}

/** À appeler depuis un geste de l'utilisateur (iOS l'exige pour demander l'autorisation). */
export async function enablePush(): Promise<PushPrefs> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Autorisation refusée dans les réglages de l’iPhone");
  const { publicKey } = await (await fetch("/api/push/config", { credentials: "same-origin" })).json();
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  return post<PushPrefs>("/api/push/subscribe", { subscription: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

export const getPushPrefs = (endpoint: string) => post<PushPrefs | null>("/api/push/get", { endpoint });
export const savePushPrefs = (endpoint: string, prefs: Partial<PushPrefs>) =>
  post<PushPrefs>("/api/push/prefs", { endpoint, ...prefs });
export const sendTestPush = (endpoint: string) => post("/api/push/test", { endpoint });
