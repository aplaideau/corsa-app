// Real back-end: the corsa-app Node server (login, setup) which relays psacc's API.

export type VehicleSnapshot = {
  batteryLevel: number;
  rangeKm: number;
  locked: boolean | null; // null = information not sent by the car
  climateActive: boolean;
  charging: boolean;
  plugged: boolean;
  chargeStatus: string; // InProgress | Finished | Stopped | Disconnected | Failure
  driving: boolean;
  speedKmh: number;
  chargeLimit: number;
  chargeRateKmh: number | null; // km of range gained per hour, as reported by the car
  fastCharge: boolean;
  remainingMinutes: number | null; // car's estimate to a full battery
  updatedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  city: string;
  country: string;
  address: string;
};

export type VehicleCommand =
  | { type: "set_lock"; value: boolean }
  | { type: "set_climate"; value: boolean }
  | { type: "set_charging"; value: boolean }
  | { type: "wakeup" }
  | { type: "set_charge_limit"; value: number };

export type SetupStatus = { psacc: boolean; loggedIn: boolean; otp: boolean; vin: string | null };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// psacc answers in English: translate the messages users can actually meet.
function translate(message: string): string {
  if (/wakeup rate limit/i.test(message)) return "Trop de demandes d’actualisation : réessayez dans 20 minutes";
  if (/rate limit/i.test(message)) return "Trop de demandes : réessayez un peu plus tard";
  if (/vin not in list|not found/i.test(message)) return "Véhicule introuvable dans le compte MyOpel";
  if (/otp|remote/i.test(message)) return "Commandes à distance non configurées (validation SMS / PIN)";
  return message;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError("Serveur injoignable", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new ApiError(data.error && data.error !== "Non connecté" ? data.error : "Session expirée, reconnectez-vous", 401);
  if (!response.ok) throw new ApiError(translate(data.error || data.message || `Erreur ${response.status}`), response.status);
  if (data && typeof data === "object" && "error" in data && data.error) throw new ApiError(translate(String(data.error)), 200);
  return data as T;
}

const postJson = <T>(url: string, body?: unknown) =>
  request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

// ---- session ---------------------------------------------------------------

export const getMe = () =>
  request<{ user: string; vin: string; getaroundUrl?: string; version?: string }>("/api/me");
export const login = (user: string, password: string, remember: boolean) =>
  postJson<{ ok: boolean }>("/api/login", { user, password, remember });
export const logout = () => postJson<{ ok: boolean }>("/api/logout");

// ---- setup (MyOpel account + SMS/PIN) ---------------------------------------

export const getSetupStatus = () => request<SetupStatus>("/api/setup/status");
export type SetupResult = { status: "done" | "manual" | "sent" | "error"; authUrl?: string; message?: string };
export const setupLogin = (email: string, password: string, country: string) =>
  postJson<SetupResult>("/api/setup/login", { email, password, country });
export const setupCode = (code: string) => postJson<SetupResult>("/api/setup/code", { code });
export const setupSms = () => postJson<SetupResult>("/api/setup/sms");
export const setupOtp = (sms: string, pin: string) => postJson<SetupResult>("/api/setup/otp", { sms, pin });

// ---- rental mode -------------------------------------------------------------

export type RentalMode = {
  enabled: boolean;
  since: string | null;
  source: "email" | "manual" | null;
  rentalId: string | null;
  plannedEnd: string | null;
  overdue: boolean;
  recording: "on" | "off" | "unknown";
  nextRental: { rentalId: string; start: string; end: string } | null;
  renterAbrp?: { linked: boolean; lastSentAt: number | null } | null;
  mail: {
    configured: boolean;
    lastCheck: string | null;
    lastError: string | null;
    lastUnrecognized: { subject: string; at: string } | null;
  };
};
export const getRentalMode = () => request<RentalMode>("/api/rental-mode");
export const setRentalMode = (enabled: boolean) => postJson<RentalMode>("/api/rental-mode", { enabled });
export const dismissUnrecognizedMail = () => postJson<RentalMode>("/api/mail/dismiss-unrecognized");

// ---- consommation ------------------------------------------------------------
export type Consumption = {
  last30: { avg: number | null; km: number; trips: number };
  rangeKm: number | null;
  soh: number | null;
  batteryKwh: number;
  monthly: { month: string; km: number; avg: number | null; trips: number }[];
  recent: { at: string; km: number; minutes: number; avg: number | null }[];
  since: string | null;
};
export const getConsumption = () => request<Consumption>("/api/consumption");

// ---- nouveautés ------------------------------------------------------------
export type Release = { version: string; date: string; items: string[]; installed: boolean };
export const getReleases = () => request<{ version: string; releases: Release[] }>("/api/releases");

// ---- vehicle ---------------------------------------------------------------

type Raw = Record<string, any>;

function minutesFromIso(duration?: string): number | null {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(duration || "");
  if (!m) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

const GEO_CACHE = "corsa-geocode-cache";

async function reverseGeocode(lat: number, lon: number) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let cache: Record<string, { city: string; country: string; address: string }> = {};
  try {
    cache = JSON.parse(localStorage.getItem(GEO_CACHE) || "{}");
    if (cache[key]) return cache[key];
  } catch {
    /* storage unavailable */
  }
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=fr&lat=${lat}&lon=${lon}`,
    );
    const d = await r.json();
    const a = d.address || {};
    const place = {
      city: a.city || a.town || a.village || a.municipality || a.county || "Position connue",
      country: a.country || "",
      address: [a.road, a.house_number].filter(Boolean).join(" ") || a.suburb || "",
    };
    try {
      cache[key] = place;
      const keys = Object.keys(cache);
      if (keys.length > 30) delete cache[keys[0]];
      localStorage.setItem(GEO_CACHE, JSON.stringify(cache));
    } catch {
      /* ignore */
    }
    return place;
  } catch {
    return { city: "Position connue", country: "", address: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  }
}

function toSnapshot(info: Raw, chargeControl: Raw | null): VehicleSnapshot {
  const energies: Raw[] = info.energy || [];
  const e = energies.find((x) => x.type === "Electric") || energies[0] || {};
  const c: Raw = e.charging || {};
  const chargeStatus = String(c.status || "").split(".").pop() || "";
  const ac = String(info.preconditionning?.air_conditioning?.status || "").split(".").pop();
  const lockedState: string[] = info.doors_state?.locked_state || [];
  const coords: number[] | undefined = info.last_position?.geometry?.coordinates;
  return {
    batteryLevel: Math.round(Number(e.level) || 0),
    rangeKm: Math.round(Number(e.autonomy) || 0),
    locked: lockedState.length ? lockedState.some((s) => /locked/i.test(s) && !/unlocked/i.test(s)) : null,
    climateActive: ac === "Enabled" || ac === "InProgress",
    charging: chargeStatus === "InProgress",
    plugged: Boolean(c.plugged),
    chargeStatus,
    driving: Boolean(info.kinetic?.moving),
    speedKmh: Math.round(Number(info.kinetic?.speed) || 0),
    chargeLimit: Number(chargeControl?.percentage_threshold) || 100,
    chargeRateKmh: c.charging_rate != null ? Number(c.charging_rate) : null,
    fastCharge: /quick|fast/i.test(String(c.charging_mode || "")),
    remainingMinutes: minutesFromIso(c.remaining_time),
    updatedAt: parseDate(e.updated_at) || parseDate(info.last_position?.properties?.updated_at),
    latitude: coords ? Number(coords[1]) : null,
    longitude: coords ? Number(coords[0]) : null,
    city: "",
    country: "",
    address: "",
  };
}

/** fresh=false reads psacc's cache (no call to the car); psacc refreshes it on its own. */
export async function getVehicleStatus(vin: string, fresh = false): Promise<VehicleSnapshot> {
  const v = encodeURIComponent(vin);
  const [info, chargeControl] = await Promise.all([
    request<Raw>(`/get_vehicleinfo/${v}${fresh ? "" : "?from_cache=1"}`),
    request<Raw>(`/charge_control?vin=${v}`).catch(() => null),
  ]);
  const snapshot = toSnapshot(info, chargeControl);
  if (snapshot.latitude != null && snapshot.longitude != null) {
    Object.assign(snapshot, await reverseGeocode(snapshot.latitude, snapshot.longitude));
  }
  return snapshot;
}

export async function sendVehicleCommand(vin: string, command: VehicleCommand): Promise<void> {
  const v = encodeURIComponent(vin);
  switch (command.type) {
    case "set_lock":
      await request(`/lock_door/${v}/${command.value ? 1 : 0}`);
      return;
    case "set_climate":
      await request(`/preconditioning/${v}/${command.value ? 1 : 0}`);
      return;
    case "set_charging":
      await request(`/charge_now/${v}/${command.value ? 1 : 0}`);
      return;
    case "wakeup":
      await request(`/wakeup/${v}`);
      return;
    case "set_charge_limit":
      await request(`/charge_control?vin=${v}&percentage=${Math.round(command.value)}`);
      return;
  }
}
