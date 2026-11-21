import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  getMe,
  getSetupStatus,
  dismissUnrecognizedMail,
  getRentalMode,
  getVehicleStatus,
  login,
  logout,
  sendVehicleCommand,
  setRentalMode,
  setupCode,
  setupLogin,
  setupOtp,
  setupSms,
  type RentalMode,
  type SetupStatus,
  type VehicleCommand,
  type VehicleSnapshot, getLayout, getConsumption, getChargings, type Layout, type Consumption, type ChargingRecord } from "./services/vehicleApi";
import { VehicleMap } from "./VehicleMap";
import { NotificationsScreen } from "./NotificationsScreen";
import { ReleasesScreen } from "./ReleasesScreen";
import { ConsumptionScreen } from "./ConsumptionScreen";
import { ChargesScreen, LayoutScreen, LocationScreen, RentalsScreen } from "./DetailScreens";

type IconName =
  | "arrowLeft"
  | "arrowUp"
  | "arrowDown"
  | "sliders"
  | "battery"
  | "bolt"
  | "calendar"
  | "car"
  | "check"
  | "chevron"
  | "climate"
  | "close"
  | "bell"
  | "external"
  | "gear"
  | "lock"
  | "logout"
  | "mapPin"
  | "menu"
  | "moon"
  | "power"
  | "refresh"
  | "route"
  | "sun"
  | "unlock";

/** Ouvre un lien externe sans la page blanche de window.open(…, "noopener") dans l'appli iPhone. */
function openExternal(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const icons: Record<IconName, ReactNode> = {
  arrowLeft: <path d="m15 18-6-6 6-6" />,
  arrowUp: <path d="m6 15 6-6 6 6" />,
  arrowDown: <path d="m6 9 6 6 6-6" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  battery: (
    <>
      <rect x="3" y="7" width="16" height="10" rx="2" />
      <path d="M21 10v4" />
      <path d="M6 10h8v4H6z" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  car: (
    <>
      <path d="m5 16-2-1v-3l2-1 2-5h10l2 5 2 1v3l-2 1" />
      <path d="M5 11h14M7 16h10" />
      <circle cx="6.5" cy="16.5" r="1.5" />
      <circle cx="17.5" cy="16.5" r="1.5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  climate: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v8M12 14v8M4.9 4.9l5.7 5.7M13.4 13.4l5.7 5.7M2 12h8M14 12h8M4.9 19.1l5.7-5.7M13.4 10.6l5.7-5.7" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5M5 12h11" />
    </>
  ),
  mapPin: (
    <>
      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  moon: <path d="M20 15.3A8.5 8.5 0 0 1 8.7 4 8.5 8.5 0 1 0 20 15.3Z" />,
  power: (
    <>
      <path d="M12 2v10" />
      <path d="M6.35 5.65a8 8 0 1 0 11.3 0" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h3a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3h2a3 3 0 0 0 3-3V7" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M16 10V7a4 4 0 0 0-7.75-1.4" />
    </>
  ),
};

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

function Control({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`control ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="control-icon">
        <Icon name={icon} size={24} />
      </span>
      <span>{label}</span>
    </button>
  );
}

const vehicleMedia = {
  parked: "/media/corsa-e-parked.webp",
  charging: "/media/corsa-e-charging.webp",
  driving: "/media/corsa-e-driving.webp",
} as const;

const vehicleAlt = {
  parked: "Opel Corsa-e orange stationnée",
  charging: "Opel Corsa-e orange en charge",
  driving: "Opel Corsa-e orange en mouvement",
} as const;

function VehicleVisual({ mode }: { mode: keyof typeof vehicleMedia }) {
  return (
    <img
      key={mode}
      className={`vehicle-media ${mode}`}
      src={vehicleMedia[mode]}
      alt={vehicleAlt[mode]}
    />
  );
}

const USABLE_BATTERY_KWH = 46.3;

const formatTime = (date: Date) =>
  new Intl.DateTimeFormat("fr-BE", { hour: "2-digit", minute: "2-digit" }).format(date);

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest.toString().padStart(2, "0")}` : `${rest} min`;
};

/** Estimated charging power (kW) from the car's own "time to full" estimate. */
function estimatePowerKw(vehicle: VehicleSnapshot): number | null {
  const { remainingMinutes, batteryLevel } = vehicle;
  if (!remainingMinutes || remainingMinutes <= 0 || batteryLevel >= 100) return null;
  return ((100 - batteryLevel) / 100) * USABLE_BATTERY_KWH / (remainingMinutes / 60);
}

function ChargeInformation({ vehicle }: { vehicle: VehicleSnapshot }) {
  const { batteryLevel, chargeLimit } = vehicle;
  const powerKw = estimatePowerKw(vehicle);
  const percentageToAdd = Math.max(0, chargeLimit - batteryLevel);
  const energyToAdd = (percentageToAdd / 100) * USABLE_BATTERY_KWH;
  const remainingMinutes =
    percentageToAdd === 0
      ? 0
      : powerKw
        ? Math.ceil((energyToAdd / powerKw) * 60)
        : vehicle.remainingMinutes;
  const base = vehicle.updatedAt ?? new Date();
  const duration =
    remainingMinutes === 0 ? "Terminée" : remainingMinutes == null ? "—" : formatDuration(remainingMinutes);
  const completionTime =
    remainingMinutes == null ? "—" : formatTime(new Date(base.getTime() + remainingMinutes * 60_000));

  return (
    <section className="charge-information" aria-label="Informations de recharge">
      <div className="charge-information-heading">
        <span className="charge-information-icon">
          <Icon name="bolt" size={19} />
        </span>
        <div>
          <span className="section-label">SESSION DE RECHARGE</span>
          <strong>{remainingMinutes === 0 ? "Limite atteinte" : "Recharge en cours"}</strong>
        </div>
        {vehicle.updatedAt && Date.now() - vehicle.updatedAt.getTime() > 15 * 60000 ? (
          <span className="live-label asleep">🌙 EN VEILLE · {formatTime(vehicle.updatedAt)}</span>
        ) : (
          <span className="live-label">
            <i /> EN DIRECT
          </span>
        )}
      </div>
      <div className="charge-metrics">
        <div>
          <span>Puissance</span>
          <strong>
            {powerKw
              ? `≈ ${powerKw.toLocaleString("fr-BE", { maximumFractionDigits: 1 })}`
              : "—"}{" "}
            <small>kW</small>
          </strong>
        </div>
        <div>
          <span>À ajouter</span>
          <strong>
            {energyToAdd.toLocaleString("fr-BE", { maximumFractionDigits: 1 })} <small>kWh</small>
          </strong>
        </div>
        <div>
          <span>Temps restant</span>
          <strong>{duration}</strong>
        </div>
      </div>
      <div className="charge-completion">
        <span>
          Fin estimée à <strong>{completionTime}</strong>
        </span>
        <span>Objectif {chargeLimit}%</span>
      </div>
    </section>
  );
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Login (single user) — same card styles as the configuration screens
// ---------------------------------------------------------------------------

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(user, password, remember);
      onLoggedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="configuration-card" onSubmit={submit}>
        <div className="login-brand">
          <img alt="" src={vehicleMedia.parked} />
          <span className="section-label">MA CORSA</span>
          <h3>Opel Corsa-e</h3>
        </div>
        <label>
          Identifiant
          <input
            autoCapitalize="none"
            autoComplete="username"
            onChange={(event) => setUser(event.target.value)}
            value={user}
          />
        </label>
        <label>
          Mot de passe
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        <label className="remember-row">
          <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
          Rester connecté
        </label>
        {error && <p className="configuration-error">{error}</p>}
        <button className="primary-action" disabled={busy} type="submit">
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuration flow (MyOpel account, manual code fallback, SMS + PIN)
// ---------------------------------------------------------------------------

type ConfigurationStep = "account" | "connection" | "remote" | "done";

function ConfigurationFlow({
  initialStep,
  onClose,
}: {
  initialStep: ConfigurationStep;
  onClose: () => void;
}) {
  const [step, setStep] = useState<ConfigurationStep>(initialStep);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("BE");
  const [authUrl, setAuthUrl] = useState("");
  const [connectionCode, setConnectionCode] = useState("");
  const [smsRequested, setSmsRequested] = useState(false);
  const [smsCode, setSmsCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const progress = step === "done" ? 3 : step === "remote" ? 2 : 1;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setError("");
    if (step === "account") onClose();
    if (step === "connection") setStep("account");
    if (step === "remote") setStep("account");
    if (step === "done") onClose();
  };

  const submitAccount = (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.includes("@") || password.length < 4) {
      setError("Renseignez une adresse e-mail et un mot de passe valides.");
      return;
    }
    void run(async () => {
      const result = await setupLogin(email, password, country);
      if (result.status === "done") setStep("remote");
      else if (result.status === "manual" && result.authUrl) {
        setAuthUrl(result.authUrl);
        setStep("connection");
      } else setError(result.message || "Connexion à MyOpel impossible.");
    });
  };

  const submitConnection = (event: React.FormEvent) => {
    event.preventDefault();
    if (connectionCode.trim().length < 4) {
      setError("Collez le code ou l’adresse complète récupérée dans le navigateur.");
      return;
    }
    void run(async () => {
      const result = await setupCode(connectionCode);
      if (result.status === "done") setStep("remote");
      else
        setError(
          `${result.message || "Code refusé."} S’il a expiré, rouvrez la page de connexion pour en obtenir un nouveau.`,
        );
    });
  };

  const requestSms = () =>
    void run(async () => {
      const result = await setupSms();
      if (result.status === "sent") setSmsRequested(true);
      else setError(result.message || "Envoi du SMS impossible.");
    });

  const submitRemote = (event: React.FormEvent) => {
    event.preventDefault();
    if (!smsRequested && !smsCode) {
      setError("Demandez d’abord la validation par SMS.");
      return;
    }
    if (!/^\d{4,12}$/.test(smsCode.trim())) {
      setError("Saisissez le code reçu par SMS.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("Saisissez votre code PIN MyOpel à 4 chiffres.");
      return;
    }
    void run(async () => {
      const result = await setupOtp(smsCode.trim(), pin);
      if (result.status === "done") setStep("done");
      else setError(result.message || "Validation refusée : vérifiez le code SMS et le PIN.");
    });
  };

  return (
    <div className="configuration-screen">
      <div className="configuration-shell">
        <header className="configuration-header">
          <button aria-label="Retour" onClick={goBack} type="button">
            <Icon name="arrowLeft" />
          </button>
          <div>
            <span className="section-label">OPEL CORSA-E</span>
            <h2>Configuration</h2>
          </div>
          <button aria-label="Fermer" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>

        <div className="configuration-progress" aria-label={`Étape ${progress} sur 3`}>
          {[1, 2, 3].map((item) => (
            <span className={item <= progress ? "active" : ""} key={item} />
          ))}
        </div>

        {step === "account" && (
          <form className="configuration-card" onSubmit={submitAccount}>
            <span className="step-number">ÉTAPE 1 SUR 3</span>
            <h3>Votre compte MyOpel</h3>
            <p>
              Utilisez les identifiants de l’application MyOpel. Ils sont transmis uniquement à
              votre serveur, qui dialogue avec Stellantis.
            </p>
            <label>
              Adresse e-mail
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="vous@exemple.be"
                type="email"
                value={email}
              />
            </label>
            <label>
              Mot de passe
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Votre mot de passe MyOpel"
                type="password"
                value={password}
              />
            </label>
            <label>
              Pays
              <select onChange={(event) => setCountry(event.target.value)} value={country}>
                <option value="BE">Belgique</option>
                <option value="FR">France</option>
                <option value="LU">Luxembourg</option>
                <option value="NL">Pays-Bas</option>
              </select>
            </label>
            {error && <p className="configuration-error">{error}</p>}
            <button className="primary-action" disabled={busy} type="submit">
              {busy ? "Connexion en cours…" : "Se connecter à MyOpel"}
            </button>
            <small>La connexion peut prendre jusqu’à deux minutes.</small>
          </form>
        )}

        {step === "connection" && (
          <form className="configuration-card" onSubmit={submitConnection}>
            <span className="step-number">ÉTAPE 1 BIS</span>
            <h3>Récupérer le code de connexion</h3>
            <p>Cette étape doit être effectuée dans Firefox ou Chrome sur un ordinateur.</p>
            <ol className="connection-instructions">
              <li>
                Ouvrez la page MyOpel ci-dessous. <strong>Avant de vous connecter</strong>, ouvrez les
                outils réseau avec <strong>F12</strong> et cochez « Conserver les journaux ».
              </li>
              <li>Connectez-vous. Si la page propose d’ouvrir une application, annulez.</li>
              <li>
                Dans l’onglet Réseau, cherchez <strong>code=</strong> (Ctrl+Maj+F) : copiez l’adresse
                commençant par <strong>mym…://</strong>, puis collez-la rapidement ici.
              </li>
            </ol>
            <button
              className="secondary-action"
              onClick={() => openExternal(authUrl)}
              type="button"
            >
              Ouvrir la page de connexion MyOpel
            </button>
            <label>
              Code ou adresse complète
              <textarea
                onChange={(event) => setConnectionCode(event.target.value)}
                placeholder="mym…://… ou valeur après code="
                rows={3}
                value={connectionCode}
              />
            </label>
            {error && <p className="configuration-error">{error}</p>}
            <button className="primary-action" disabled={busy} type="submit">
              {busy ? "Validation…" : "Valider le code"}
            </button>
          </form>
        )}

        {step === "remote" && (
          <form className="configuration-card" onSubmit={submitRemote}>
            <span className="step-number">ÉTAPE 2 SUR 3</span>
            <h3>Autoriser les commandes à distance</h3>
            <p>
              La recharge et le préchauffage nécessitent une validation SMS et votre code PIN
              MyOpel.
            </p>
            <button
              className="secondary-action"
              disabled={busy || smsRequested}
              onClick={requestSms}
              type="button"
            >
              {busy && !smsRequested
                ? "Demande en cours…"
                : smsRequested
                  ? "SMS de validation envoyé"
                  : "Recevoir le SMS de validation"}
            </button>
            <small>Évitez plusieurs demandes successives : Stellantis limite les envois.</small>
            <label>
              Code reçu par SMS
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, ""))}
                placeholder="Code reçu par SMS"
                value={smsCode}
              />
            </label>
            <label>
              Code PIN MyOpel
              <input
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                placeholder="4 chiffres"
                type="password"
                value={pin}
              />
            </label>
            {error && <p className="configuration-error">{error}</p>}
            <button className="primary-action" disabled={busy} type="submit">
              {busy ? "Vérification…" : "Terminer la configuration"}
            </button>
          </form>
        )}

        {step === "done" && (
          <section className="configuration-card configuration-success">
            <span className="success-icon">
              <Icon name="check" size={34} />
            </span>
            <span className="step-number">CONFIGURATION TERMINÉE</span>
            <h3>Tout est configuré</h3>
            <p>Votre Corsa-e est prête à recevoir des commandes à distance.</p>
            <button className="primary-action" onClick={onClose} type="button">
              Ouvrir ma Corsa-e
            </button>
            <button className="secondary-action" onClick={() => setStep("remote")} type="button">
              Refaire la validation SMS / PIN
            </button>
            <button className="text-action" onClick={() => setStep("account")} type="button">
              Reconnecter le compte MyOpel
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const emptyVehicle: VehicleSnapshot = {
  batteryLevel: 0,
  rangeKm: 0,
  locked: null,
  climateActive: false,
  charging: false,
  plugged: false,
  chargeStatus: "",
  driving: false,
  speedKmh: 0,
  chargeLimit: 100,
  chargeRateKmh: null,
  fastCharge: false,
  remainingMinutes: null,
  updatedAt: null,
  latitude: null,
  longitude: null,
  city: "—",
  country: "",
  address: "",
};

// Page « Ouvrir / fermer » de la voiture chez Getaround (fournie par le serveur, variable GETAROUND_URL).
const GETAROUND_FALLBACK_URL = "https://fr.be.getaround.com/dashboard";

const THEME_KEY = "corsa-theme";
const readTheme = () => {
  try {
    return localStorage.getItem(THEME_KEY) !== "light";
  } catch {
    return true;
  }
};

const initialStepFor = (status: SetupStatus | null): ConfigurationStep =>
  !status?.loggedIn ? "account" : !status.otp ? "remote" : "done";

function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [dark, setDark] = useState(readTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(window.location.pathname === "/setup");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [consumptionOpen, setConsumptionOpen] = useState(false);
  const [chargesOpen, setChargesOpen] = useState(false);
  const [rentalsOpen, setRentalsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>({
    cards: [
      { id: "location", on: true },
      { id: "nextRental", on: true },
      { id: "consumption", on: true },
    ],
    chargeWhenIdle: false,
  });
  const [consumption, setConsumption] = useState<Consumption | null>(null);
  const [lastCharge, setLastCharge] = useState<ChargingRecord | null>(null);

  // accueil personnalisable : réglage gardé sur le serveur
  useEffect(() => {
    getLayout().then(setLayout).catch(() => undefined);
  }, []);
  const cardOn = (id: string) => layout.cards.some((c) => c.id === id && c.on);
  useEffect(() => {
    if (cardOn("consumption")) getConsumption().then(setConsumption).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  useEffect(() => {
    if (layout.chargeWhenIdle) getChargings().then((r) => setLastCharge(r.chargings[0] ?? null)).catch(() => undefined);
  }, [layout.chargeWhenIdle]);
  const [releasesOpen, setReleasesOpen] = useState(
    () => new URLSearchParams(window.location.search).get("view") === "releases",
  );

  // retour dans l'appli (après Getaround, Maps…) : l'iPhone a pu geler une animation du menu en cours ;
  // on la termine instantanément pour qu'aucun calque invisible ne reste devant l'écran
  useEffect(() => {
    const finishAnimations = () => {
      if (document.visibilityState !== "visible") return;
      const root = document.documentElement;
      root.classList.add("no-anim");
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-anim")));
    };
    document.addEventListener("visibilitychange", finishAnimations);
    window.addEventListener("pageshow", finishAnimations);
    return () => {
      document.removeEventListener("visibilitychange", finishAnimations);
      window.removeEventListener("pageshow", finishAnimations);
    };
  }, []);

  // notification « Mise à jour installée » : ouvre l'écran Nouveautés
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("view")) window.history.replaceState(null, "", window.location.pathname);
    const onMessage = (event: MessageEvent) => {
      const url = event.data?.type === "open" ? String(event.data.url || "") : "";
      if (url.includes("view=releases")) {
        setMenuOpen(false);
        setReleasesOpen(true);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  const [vin, setVin] = useState("");
  const [getaroundUrl, setGetaroundUrl] = useState(GETAROUND_FALLBACK_URL);
  const [version, setVersion] = useState("");
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [vehicle, setVehicle] = useState<VehicleSnapshot>(emptyVehicle);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState<false | "server" | "psacc">(false);
  const [syncing, setSyncing] = useState(true);
  const [toast, setToast] = useState("");
  const [draftLimit, setDraftLimit] = useState<number | null>(null);
  const [rental, setRental] = useState<RentalMode | null>(null);
  const [rentalBusy, setRentalBusy] = useState(false);
  const rentalOn = Boolean(rental?.enabled);
  const toastTimer = useRef<number | undefined>(undefined);
  const followUp = useRef<number | undefined>(undefined);
  const vehicleMode = vehicle.driving ? "driving" : vehicle.charging ? "charging" : "parked";
  const chargeLimit = draftLimit ?? vehicle.chargeLimit;

  const notify = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  };

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return onLoggedOut();
      notify(errorMessage(e));
    },
    [onLoggedOut],
  );

  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  const refresh = useCallback(
    async (currentVin: string, fresh = false) => {
      if (!currentVin) return;
      setSyncing(true);
      try {
        setVehicle(await getVehicleStatus(currentVin, fresh));
        setOffline(false);
        setLoaded(true);
      } catch (e) {
        setOffline(e instanceof ApiError && e.status === 0 ? "server" : "psacc");
        if (e instanceof ApiError && e.status === 401) onLoggedOut();
      } finally {
        setSyncing(false);
      }
    },
    [onLoggedOut],
  );

  const loadAll = useCallback(async () => {
    try {
      const [me, status, rentalMode] = await Promise.all([
        getMe(),
        getSetupStatus(),
        getRentalMode().catch(() => null),
      ]);
      setSetup(status);
      setRental(rentalMode);
      if (me.getaroundUrl) setGetaroundUrl(me.getaroundUrl);
      if (me.version) setVersion(me.version);
      const currentVin = me.vin || status.vin || "";
      setVin(currentVin);
      if (status.psacc && !status.loggedIn) setConfigurationOpen(true);
      await refresh(currentVin);
    } catch (e) {
      setSyncing(false);
      if (e instanceof ApiError && e.status === 0) setOffline("server");
      else handleError(e);
    }
  }, [refresh, handleError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // psacc refreshes the car state on its own: re-read its cache every minute.
  useEffect(() => {
    if (!vin) return;
    const timer = window.setInterval(() => {
      void refresh(vin);
      getRentalMode().then(setRental).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [vin, refresh]);

  // « Actualiser » : pendant une charge, psacc sollicite déjà la voiture toutes les 2 minutes
  // (quota de 6 réveils / 20 min) — on relit seulement ses dernières données.
  const actualise = async () => {
    if (!vin) return notify("Véhicule non configuré");
    if (vehicle.charging) {
      await refresh(vin);
      return notify("Données rechargées · la voiture est déjà suivie pendant la charge");
    }
    setSyncing(true);
    try {
      await sendVehicleCommand(vin, { type: "wakeup" });
      notify("Demande envoyée à la voiture");
      window.clearTimeout(followUp.current);
      followUp.current = window.setTimeout(() => void refresh(vin), 75_000);
    } catch (e) {
      if (e instanceof ApiError && /trop de demandes/i.test(e.message)) {
        setSyncing(false);
        await refresh(vin);
        return notify("La voiture a déjà été sollicitée récemment · données rechargées");
      }
      handleError(e);
    } finally {
      setSyncing(false);
    }
  };

  const runCommand = async (command: VehicleCommand, successMessage: string, optimistic?: Partial<VehicleSnapshot>) => {
    if (!vin) return notify("Véhicule non configuré");
    setSyncing(true);
    try {
      await sendVehicleCommand(vin, command);
      if (optimistic) setVehicle((current) => ({ ...current, ...optimistic }));
      notify(successMessage);
      // The car takes 1–2 minutes to react: read its state again a bit later.
      window.clearTimeout(followUp.current);
      followUp.current = window.setTimeout(() => void refresh(vin), 75_000);
    } catch (e) {
      handleError(e);
    } finally {
      setSyncing(false);
    }
  };

  const commitLimit = () => {
    if (draftLimit == null || draftLimit === vehicle.chargeLimit) return setDraftLimit(null);
    const value = draftLimit;
    void runCommand({ type: "set_charge_limit", value }, `Limite fixée à ${value}%`, { chargeLimit: value }).finally(
      () => setDraftLimit(null),
    );
  };

  const toggleRental = async () => {
    const enable = !rentalOn;
    if (
      enable &&
      !window.confirm(
        "Activer le mode location ?\n\nLa position sera masquée, les trajets ne seront plus enregistrés et l’envoi vers ABRP sera coupé. La limite de charge reste active.",
      )
    )
      return;
    setRentalBusy(true);
    try {
      const result = await setRentalMode(enable);
      setRental(result);
      notify(enable ? "Mode location activé" : "Mode location désactivé");
      void refresh(vin);
    } catch (e) {
      handleError(e);
    } finally {
      setRentalBusy(false);
    }
  };

  const toggleLock = () => {
    if (rentalOn) return notify("Pendant une location, utilisez l’application Getaround");
    const lock = vehicle.locked === false;
    const message = lock
      ? "Verrouiller la voiture via Opel ?"
      : "Déverrouiller la voiture via Opel ?\n\nPendant une location Getaround, utilisez plutôt l’application Getaround : un verrouillage Opel peut empêcher le locataire d’ouvrir.";
    if (!window.confirm(message)) return;
    void runCommand(
      { type: "set_lock", value: lock },
      lock ? "Verrouillage demandé" : "Déverrouillage demandé",
      { locked: lock },
    );
  };

  const updatedLabel = vehicle.updatedAt ? formatTime(vehicle.updatedAt) : null;
  // données de plus de 15 min : la voiture est en veille, ce qui est affiché est sa dernière photo
  const asleepSince =
    loaded && vehicle.updatedAt && Date.now() - vehicle.updatedAt.getTime() > 15 * 60000 ? vehicle.updatedAt : null;
  const asleepLabel = asleepSince
    ? `En veille depuis ${
        asleepSince.toDateString() === new Date().toDateString()
          ? formatTime(asleepSince)
          : new Intl.DateTimeFormat("fr-BE", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(asleepSince)
      }`
    : null;
  const formatDayTime = (iso: string) =>
    new Intl.DateTimeFormat("fr-BE", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const rentalBanner = !rentalOn
    ? ""
    : rental?.overdue && rental.rentalId
      ? `Location #${rental.rentalId} : fin non confirmée (retour prévu ${formatDayTime(rental.plannedEnd!)})`
      : rental?.rentalId
        ? `Location #${rental.rentalId} en cours${rental.plannedEnd ? ` · retour prévu ${formatDayTime(rental.plannedEnd)}` : ""}`
        : "Mode location · position masquée";
  const next = rental?.nextRental ?? null;
  const formatSlot = (iso: string) =>
    new Intl.DateTimeFormat("fr-BE", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  const daysUntil = (iso: string) => {
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((day(new Date(iso)) - day(new Date())) / 86400000);
  };
  const nextRentalText = next
    ? new Date(next.start).getTime() <= Date.now()
      ? `Location prévue depuis ${formatSlot(next.start)} · en attente du locataire`
      : `Prochaine location : ${formatSlot(next.start)} → ${formatSlot(next.end)}${(() => {
          const d = daysUntil(next.start);
          return d === 0 ? " (aujourd’hui)" : d === 1 ? " (demain)" : ` (dans ${d} jours)`;
        })()}`
    : "Aucune location prévue";
  const mailInfo = rental?.mail?.configured
    ? rental.mail.lastError
      ? "⚠️ Lecture des e-mails Getaround en échec"
      : `Automatique via les e-mails Getaround${rental.mail.lastCheck ? ` · lus à ${formatTime(new Date(rental.mail.lastCheck))}` : ""}`
    : null;
  const powerKw = estimatePowerKw(vehicle);
  const statusText = vehicle.driving
    ? `En route${vehicle.speedKmh ? ` · ${vehicle.speedKmh} km/h` : ""}`
    : vehicle.charging
      ? `En charge${powerKw ? ` · ${powerKw.toLocaleString("fr-BE", { maximumFractionDigits: 1 })} kW` : ""}`
      : vehicle.plugged
        ? vehicle.chargeStatus === "Finished"
          ? "Branchée · charge terminée"
          : "Branchée · en attente"
        : `Parquée${updatedLabel ? ` · vue à ${updatedLabel}` : ""}`;
  const rangeAtLimit =
    vehicle.batteryLevel > 0
      ? Math.round((vehicle.rangeKm / vehicle.batteryLevel) * chargeLimit)
      : Math.round((322 * chargeLimit) / 100);
  // carte réelle seulement si la position est connue et hors mode location
  const showRealMap = !rentalOn && vehicle.latitude != null && vehicle.longitude != null;
  const mapsUrl =
    vehicle.latitude != null && vehicle.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${vehicle.latitude},${vehicle.longitude}`
      : null;

  const LOCATION_CARD = (
        <button aria-label="Position : voir le détail" className="location-card card card-link" key="location" onClick={() => setLocationOpen(true)} type="button">
          <div className="map" aria-label="Carte de localisation du véhicule">
            <svg viewBox="0 0 500 220" preserveAspectRatio="none" aria-hidden="true">
              <path className="map-road major" d="M-30 184C80 125 146 157 232 88S399 36 535 82" />
              <path
                className="map-road"
                d="M78-15c22 58 30 112 10 250M286-20c-8 80 25 153 85 258M-20 56c92 22 170 14 253-12M249 182c70-15 129-4 270-51"
              />
              <path
                className="map-road minor"
                d="M140-5c44 70 24 135-18 228M365-10c-24 62-6 116 63 231M-10 116c80-20 132 10 202 62M313 32c42 35 113 35 205 10"
              />
            </svg>
            {showRealMap && (
              <VehicleMap dark={dark} latitude={vehicle.latitude!} longitude={vehicle.longitude!} />
            )}
            {!rentalOn && (
              <div className={`map-marker ${showRealMap ? "real" : ""}`}>
                <span>
                  <Icon name="car" size={20} />
                </span>
              </div>
            )}
            <div className="map-overlay" />
          </div>
          <div className="location-details">
            <span className="location-icon">
              <Icon name="mapPin" size={22} />
            </span>
            <div>
              <span className="section-label">LOCALISATION</span>
              <h2>
                {rentalOn
                  ? "Position masquée"
                  : `${vehicle.city}${vehicle.country ? `, ${vehicle.country}` : ""}`}
              </h2>
              <p>
                {rentalOn
                  ? "Mode location : la position n’est ni affichée ni enregistrée"
                  : [vehicle.address, updatedLabel ? `mise à jour à ${updatedLabel}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Position inconnue"}
              </p>
            </div>
            <span className="location-icon card-chevron" aria-hidden="true">
              <Icon name="chevron" size={20} />
            </span>
          </div>
        </button>
  );

  return (
    <div className={dark ? "app dark" : "app light"}>
      <main className="phone-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">MA CORSA</p>
            <h1>Opel Corsa-e</h1>
            <div className={`battery-line ${loaded && vehicle.batteryLevel < 20 ? "low-battery" : ""}`}>
              <Icon name="battery" size={20} />
              <strong>{loaded ? `${vehicle.batteryLevel}%` : "—"}</strong>
              <span>·</span>
              <span>{loaded ? `${vehicle.rangeKm} km` : "—"}</span>
              <span
                className={`sync-state ${syncing ? "syncing" : ""} ${offline && !syncing ? "error" : ""} ${
                  !syncing && !offline && asleepLabel ? "asleep" : ""
                }`}
              >
                {syncing
                  ? "Synchronisation…"
                  : offline === "server"
                    ? "Serveur injoignable"
                    : offline
                      ? "Hors ligne"
                      : asleepLabel
                        ? `🌙 ${asleepLabel}`
                        : "Connectée · à jour"}
              </span>
            </div>
          </div>
          <button
            aria-label="Ouvrir les options"
            className="round-button"
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <Icon name="menu" />
          </button>
        </header>

        {rentalOn && (
          <button className="setup-banner" onClick={() => setMenuOpen(true)} type="button">
            <Icon name="lock" size={18} />
            <span>
              {rentalBanner}
              {rental?.renterAbrp?.linked ? " · ABRP du locataire relié" : ""}
              {rental?.recording === "on" ? " (application en cours…)" : ""}
            </span>
            <span>Gérer</span>
          </button>
        )}

        {rental?.mail?.lastUnrecognized && (
          <div className="setup-banner">
            <Icon name="gear" size={18} />
            <span>E-mail Getaround non reconnu : « {rental.mail.lastUnrecognized.subject} »</span>
            <button
              className="banner-action"
              onClick={() => void dismissUnrecognizedMail().then(setRental).catch(handleError)}
              type="button"
            >
              Ignorer
            </button>
          </div>
        )}

        {setup?.loggedIn && !setup.otp && (
          <button className="setup-banner" onClick={() => setConfigurationOpen(true)} type="button">
            <Icon name="gear" size={18} />
            <span>Commandes à distance non configurées</span>
            <span>Terminer</span>
          </button>
        )}

        <section className="vehicle-section" aria-label="État du véhicule">
          <div className={`status-pill ${vehicleMode}`}>
            <span className={vehicleMode !== "parked" ? "status-dot pulse" : "status-dot"} />
            {loaded ? statusText : offline ? "Données indisponibles" : "Chargement…"}
          </div>
          <div className={`vehicle-frame ${vehicleMode}`}>
            <div className="halo" />
            <VehicleVisual mode={vehicleMode} />
            <div className="vehicle-shade" />
            {vehicle.charging && (
              <div className="charge-badge">
                <Icon name="bolt" size={18} /> Recharge en cours
              </div>
            )}
          </div>
        </section>

        <section className="controls" aria-label="Commandes rapides">
          <Control
            active={vehicle.locked === false}
            icon={vehicle.locked === false ? "unlock" : "lock"}
            label={vehicle.locked == null ? "Verrou" : vehicle.locked ? "Verrouillée" : "Ouverte"}
            onClick={toggleLock}
          />
          <Control
            active={vehicle.climateActive}
            icon="climate"
            label={vehicle.climateActive ? "Clim. active" : "Préchauffer"}
            onClick={() => {
              void runCommand(
                { type: "set_climate", value: !vehicle.climateActive },
                vehicle.climateActive ? "Arrêt du préchauffage demandé" : "Préchauffage demandé",
                { climateActive: !vehicle.climateActive },
              );
            }}
          />
          <Control
            active={vehicle.charging}
            icon="bolt"
            label={vehicle.charging ? "En charge" : "Recharger"}
            onClick={() => {
              if (!vehicle.charging && !vehicle.plugged) return notify("La voiture n’est pas branchée");
              void runCommand(
                { type: "set_charging", value: !vehicle.charging },
                vehicle.charging ? "Arrêt de la recharge demandé" : "Démarrage de la recharge demandé",
              );
            }}
          />
          <Control
            disabled={syncing}
            icon="refresh"
            label="Actualiser"
            onClick={() => void actualise()}
          />
        </section>

        <section className="charge-card card">
          <div className="card-heading">
            <div>
              <span className="section-label">LIMITE DE CHARGE</span>
              <h2>{chargeLimit}%</h2>
            </div>
            <span className="estimate">≈ {rangeAtLimit} km</span>
          </div>
          <input
            aria-label="Limite de charge"
            className="range"
            max="100"
            min="50"
            step="5"
            onChange={(event) => setDraftLimit(Number(event.target.value))}
            onPointerUp={commitLimit}
            onKeyUp={commitLimit}
            onBlur={commitLimit}
            style={
              {
                "--progress": `${((chargeLimit - 50) / 50) * 100}%`,
              } as React.CSSProperties
            }
            type="range"
            value={chargeLimit}
          />
          <div className="range-labels">
            <span>50%</span>
            <span>Usage quotidien recommandé : 80%</span>
            <span>100%</span>
          </div>
        </section>

        {vehicle.charging ? (
          <button aria-label="Recharge : voir l’historique" className="card-link charge-link" onClick={() => setChargesOpen(true)} type="button">
            <ChargeInformation vehicle={{ ...vehicle, chargeLimit }} />
          </button>
        ) : (
          layout.chargeWhenIdle && (
            <button aria-label="Recharges : voir l’historique" className="card card-link mini-card" onClick={() => setChargesOpen(true)} type="button">
              <span className="mini-card-icon"><Icon name="bolt" size={20} /></span>
              <span className="mini-card-body">
                <span className="section-label">DERNIÈRE RECHARGE</span>
                <strong>
                  {lastCharge
                    ? `${new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric", month: "short" }).format(new Date(lastCharge.start))}${lastCharge.kwh != null ? ` · ${lastCharge.kwh.toLocaleString("fr-BE")} kWh` : ""}`
                    : "Aucune recharge enregistrée"}
                </strong>
                {lastCharge && lastCharge.from != null && lastCharge.to != null && (
                  <small>{lastCharge.from} % → {lastCharge.to} %</small>
                )}
              </span>
              <Icon name="chevron" size={19} />
            </button>
          )
        )}


        {layout.cards
          .filter((c) => c.on)
          .map((c) => {
            if (c.id === "location") return LOCATION_CARD;
            if (c.id === "nextRental")
              return (
                <button aria-label="Locations prévues : voir la liste" className="card card-link mini-card" key="nextRental" onClick={() => setRentalsOpen(true)} type="button">
                  <span className="mini-card-icon"><Icon name="calendar" size={20} /></span>
                  <span className="mini-card-body">
                    <span className="section-label">PROCHAINE LOCATION</span>
                    <strong>{rental?.mail?.configured ? nextRentalText.replace(/^Prochaine location : /, "") : "Relève des e-mails non configurée"}</strong>
                  </span>
                  <Icon name="chevron" size={19} />
                </button>
              );
            return (
              <button aria-label="Consommation : voir le détail" className="card card-link mini-card" key="consumption" onClick={() => setConsumptionOpen(true)} type="button">
                <span className="mini-card-icon"><Icon name="route" size={20} /></span>
                <span className="mini-card-body">
                  <span className="section-label">CONSOMMATION · 30 JOURS</span>
                  <strong>
                    {consumption?.last30.avg != null
                      ? `${consumption.last30.avg.toLocaleString("fr-BE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh/100 km`
                      : "Pas encore assez de trajets"}
                  </strong>
                  {consumption?.rangeKm != null && <small>Autonomie réelle ≈ {consumption.rangeKm} km</small>}
                </span>
                <Icon name="chevron" size={19} />
              </button>
            );
          })}

        <div className="demo-note">
          <span>
            {offline === "server" ? "SERVEUR INJOIGNABLE" : offline ? "PSACC INJOIGNABLE" : "DONNÉES DU VÉHICULE"}
          </span>
          <p>
            {offline === "server"
              ? "Ton serveur ne répond pas. Sur un Wi-Fi d’entreprise, Tailscale est souvent bloqué : passe en 4G/5G et vérifie que Tailscale est activé."
              : offline
                ? "Le serveur répond, mais pas psacc : il est peut-être en pause (location) ou en cours de redémarrage."
                : "La voiture transmet son état toutes les quelques minutes ; une commande met 1 à 2 minutes à s’appliquer."}
          </p>
        </div>
      </main>

      {notificationsOpen && (
        <NotificationsScreen
          backIcon={<Icon name="arrowLeft" />}
          closeIcon={<Icon name="close" />}
          onClose={() => setNotificationsOpen(false)}
        />
      )}

      {chargesOpen && (
        <ChargesScreen backIcon={<Icon name="arrowLeft" />} closeIcon={<Icon name="close" />} onClose={() => setChargesOpen(false)} />
      )}

      {rentalsOpen && (
        <RentalsScreen
          backIcon={<Icon name="arrowLeft" />}
          closeIcon={<Icon name="close" />}
          getaroundUrl={getaroundUrl}
          onClose={() => setRentalsOpen(false)}
          openExternal={openExternal}
        />
      )}

      {locationOpen && (
        <LocationScreen
          backIcon={<Icon name="arrowLeft" />}
          closeIcon={<Icon name="close" />}
          detail={[vehicle.address, updatedLabel ? `mise à jour à ${updatedLabel}` : null].filter(Boolean).join(" · ") || "Position inconnue"}
          hidden={rentalOn}
          map={
            showRealMap ? (
              <>
                <VehicleMap dark={dark} latitude={vehicle.latitude!} longitude={vehicle.longitude!} />
                <div className="map-marker real">
                  <span>
                    <Icon name="car" size={20} />
                  </span>
                </div>
              </>
            ) : null
          }
          mapsUrl={mapsUrl || null}
          onClose={() => setLocationOpen(false)}
          openExternal={openExternal}
          place={`${vehicle.city}${vehicle.country ? `, ${vehicle.country}` : ""}`}
        />
      )}

      {layoutOpen && (
        <LayoutScreen
          arrowDown={<Icon name="arrowDown" size={18} />}
          arrowUp={<Icon name="arrowUp" size={18} />}
          backIcon={<Icon name="arrowLeft" />}
          closeIcon={<Icon name="close" />}
          layout={layout}
          onChange={setLayout}
          onClose={() => setLayoutOpen(false)}
        />
      )}

      {consumptionOpen && (
        <ConsumptionScreen
          backIcon={<Icon name="arrowLeft" />}
          closeIcon={<Icon name="close" />}
          onClose={() => setConsumptionOpen(false)}
        />
      )}

      {releasesOpen && (
        <ReleasesScreen
          backIcon={<Icon name="arrowLeft" />}
          closeIcon={<Icon name="close" />}
          onClose={() => setReleasesOpen(false)}
        />
      )}

      {configurationOpen && (
        <ConfigurationFlow
          initialStep={initialStepFor(setup)}
          onClose={() => {
            setConfigurationOpen(false);
            if (window.location.pathname === "/setup") window.history.replaceState(null, "", "/corsa");
            void loadAll();
          }}
        />
      )}

      <div
        className={`menu-backdrop ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`options-panel ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <div className="panel-handle" />
        <div className="panel-title">
          <div>
            <span className="section-label">VOTRE VÉHICULE</span>
            <h2>Options</h2>
          </div>
          <button aria-label="Fermer les options" onClick={() => setMenuOpen(false)} type="button">
            <Icon name="close" />
          </button>
        </div>
        <button className="option-row" onClick={() => setDark(!dark)} type="button">
          <span className="option-icon">
            <Icon name={dark ? "moon" : "sun"} />
          </span>
          <span>
            <strong>Apparence</strong>
            <small>{dark ? "Mode sombre" : "Mode clair"}</small>
          </span>
          <span className={`toggle ${dark ? "on" : ""}`}>
            <i />
          </span>
        </button>
        <button className="option-row" disabled={rentalBusy} onClick={() => void toggleRental()} type="button">
          <span className="option-icon">
            <Icon name={rentalOn ? "lock" : "unlock"} />
          </span>
          <span>
            <strong>Mode location</strong>
            <small>
              {rentalBusy
                ? "Application…"
                : rentalOn
                  ? "Position masquée, trajets non enregistrés"
                  : "À activer pendant une location Getaround"}
              {mailInfo && (
                <>
                  <br />
                  {mailInfo}
                </>
              )}
            </small>
          </span>
          <span className={`toggle ${rentalOn ? "on" : ""}`}>
            <i />
          </span>
        </button>
        <button
          className="option-row"
          onClick={() => {
            setMenuOpen(false);
            setNotificationsOpen(true);
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="bell" />
          </span>
          <span>
            <strong>Notifications</strong>
            <small>Locations, charge, batterie</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <button
          className="option-row"
          onClick={() => {
            setMenuOpen(false);
            setConfigurationOpen(true);
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="gear" />
          </span>
          <span>
            <strong>Configuration</strong>
            <small>Compte, véhicule et connexion</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <button
          className="option-row"
          onClick={() => {
            setMenuOpen(false);
            openExternal(getaroundUrl);
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="unlock" />
          </span>
          <span>
            <strong>Ouvrir / fermer via Getaround</strong>
            <small>Page Getaround de la voiture (boîtier Connect)</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <button
          className="option-row"
          onClick={() => {
            setMenuOpen(false);
            setLayoutOpen(true);
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="sliders" />
          </span>
          <span>
            <strong>Personnaliser l’accueil</strong>
            <small>Cartes affichées et leur ordre</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <button
          className="option-row"
          onClick={() => {
            setMenuOpen(false);
            setConsumptionOpen(true);
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="bolt" />
          </span>
          <span>
            <strong>Consommation</strong>
            <small>Moyennes et derniers trajets</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <button
          className="option-row"
          onClick={() => {
            setMenuOpen(false);
            setReleasesOpen(true);
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="refresh" />
          </span>
          <span>
            <strong>Nouveautés</strong>
            <small>Historique des versions</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <button
          className="option-row"
          onClick={() => {
            setMenuOpen(false);
            openExternal("/");
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="external" />
          </span>
          <span>
            <strong>Interface complète</strong>
            <small>Trajets, historique des charges, carte (psacc)</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <button
          className="option-row danger"
          onClick={() => {
            void logout().finally(onLoggedOut);
          }}
          type="button"
        >
          <span className="option-icon">
            <Icon name="logout" />
          </span>
          <span>
            <strong>Se déconnecter</strong>
            <small>Fermer la session sur cet appareil</small>
          </span>
          <Icon name="chevron" size={19} />
        </button>
        <p className="panel-footnote">
          Corsa-e{vin ? ` · VIN …${vin.slice(-6)}` : ""}
          {version ? ` · version ${version}` : ""}
        </p>
      </aside>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function App() {
  const [auth, setAuth] = useState<"checking" | "login" | "ready">("checking");
  const dark = readTheme();

  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    getMe()
      .then(() => setAuth("ready"))
      .catch(() => setAuth("login"));
  }, [dark]);

  if (auth === "checking") return <div className={dark ? "app dark" : "app light"} />;

  if (auth === "login") {
    return (
      <div className={dark ? "app dark" : "app light"}>
        <LoginScreen
          onLoggedIn={() => {
            if (window.location.pathname === "/login") window.history.replaceState(null, "", "/corsa");
            setAuth("ready");
          }}
        />
      </div>
    );
  }

  return (
    <Dashboard
      onLoggedOut={() => {
        window.history.replaceState(null, "", "/login");
        setAuth("login");
      }}
    />
  );
}
