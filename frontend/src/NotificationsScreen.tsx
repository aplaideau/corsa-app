import { useEffect, useState, type ReactNode } from "react";
import {
  currentSubscription,
  disablePush,
  enablePush,
  getPushPrefs,
  getTypes,
  pushSupport,
  savePushPrefs,
  sendTestPush,
  type PushPrefs,
} from "./services/push";

const ORDER = [
  "rental_start",
  "rental_end",
  "rental_overdue",
  "charge_done",
  "charge_interrupted",
  "battery_low",
  "technical",
  "update",
];

const HINTS: Record<string, string> = {
  rental_start: "Le locataire a ouvert la voiture",
  rental_end: "Le locataire a rendu la voiture",
  rental_overdue: "Pas de fin 2 h après le retour prévu",
  charge_done: "Limite de charge atteinte",
  charge_interrupted: "Arrêt avant la limite",
  battery_low: "Voiture garée, batterie sous le seuil",
  technical: "Connexion à la voiture ou e-mails en panne",
  update: "Nouvelle version installée, avec les nouveautés",
};

const REASONS: Record<string, string> = {
  insecure:
    "Les notifications demandent une connexion sécurisée : ouvre l’appli par son adresse https://…ts.net (Tailscale).",
  "not-installed":
    "Sur iPhone, ajoute d’abord l’appli à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis rouvre-la depuis l’icône.",
  unsupported: "Ce navigateur ne gère pas les notifications.",
  denied: "Les notifications sont bloquées : autorise-les dans Réglages → Notifications → Ma Corsa.",
};

export function NotificationsScreen({
  onClose,
  backIcon,
  closeIcon,
}: {
  onClose: () => void;
  backIcon: ReactNode;
  closeIcon: ReactNode;
}) {
  const support = pushSupport();
  const [types, setTypes] = useState<Record<string, string>>({});
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    getTypes()
      .then(setTypes)
      .catch(() => setServerDown(true));
    if (!support.ok) return;
    currentSubscription().then(async (sub) => {
      if (!sub) return;
      try {
        const p = await getPushPrefs(sub.endpoint);
        if (p) {
          setEndpoint(sub.endpoint);
          setPrefs(p);
        }
      } catch {
        setServerDown(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleMaster = () =>
    run(async () => {
      if (endpoint) {
        await disablePush();
        setEndpoint(null);
        setPrefs(null);
        setMessage("Notifications désactivées sur cet appareil.");
      } else {
        const p = await enablePush();
        const sub = await currentSubscription();
        setEndpoint(sub?.endpoint ?? null);
        setPrefs(p);
        setMessage("Notifications activées ✔");
      }
    });

  const update = (patch: Partial<PushPrefs>) => {
    if (!endpoint || !prefs) return;
    const optimistic = { ...prefs, ...patch, prefs: { ...prefs.prefs, ...(patch.prefs || {}) } };
    setPrefs(optimistic);
    void savePushPrefs(endpoint, patch).then(setPrefs).catch((e) => setError(String(e.message || e)));
  };

  return (
    <div className="configuration-screen">
      <div className="configuration-shell">
        <header className="configuration-header">
          <button aria-label="Retour" onClick={onClose} type="button">
            {backIcon}
          </button>
          <div>
            <span className="section-label">OPEL CORSA-E</span>
            <h2>Notifications</h2>
          </div>
          <button aria-label="Fermer" onClick={onClose} type="button">
            {closeIcon}
          </button>
        </header>

        <section className="configuration-card notif-card">
          {serverDown ? (
            <>
              <h3>Serveur injoignable</h3>
              <p>
                Impossible de lire tes réglages : ton serveur ne répond pas. Sur un Wi-Fi d’entreprise, Tailscale
                est souvent bloqué : passe en 4G/5G puis rouvre cet écran.
              </p>
              <p>Tes notifications continuent d’arriver normalement, même sur ce Wi-Fi.</p>
            </>
          ) : !support.ok ? (
            <>
              <h3>Pas encore disponible ici</h3>
              <p>{REASONS[support.reason]}</p>
            </>
          ) : (
            <>
              <button className="notif-row master" disabled={busy} onClick={toggleMaster} type="button">
                <span>
                  <strong>Activer sur cet appareil</strong>
                  <small>{endpoint ? "Cet appareil reçoit les notifications" : "Demande l’autorisation de l’iPhone"}</small>
                </span>
                <span className={`toggle ${endpoint ? "on" : ""}`}>
                  <i />
                </span>
              </button>

              {endpoint && prefs && (
                <>
                  <span className="step-number notif-heading">TYPES DE NOTIFICATIONS</span>
                  {ORDER.filter((t) => types[t]).map((t) => (
                    <button
                      className="notif-row"
                      key={t}
                      onClick={() => update({ prefs: { [t]: !prefs.prefs[t] } })}
                      type="button"
                    >
                      <span>
                        <strong>{types[t]}</strong>
                        <small>
                          {t === "battery_low" ? `Voiture garée, batterie sous ${prefs.lowBattery} %` : HINTS[t]}
                        </small>
                      </span>
                      <span className={`toggle ${prefs.prefs[t] ? "on" : ""}`}>
                        <i />
                      </span>
                    </button>
                  ))}

                  {prefs.prefs.battery_low && (
                    <label className="notif-threshold">
                      Seuil de batterie basse : <strong>{prefs.lowBattery} %</strong>
                      <input
                        className="range"
                        max="50"
                        min="5"
                        onChange={(e) => setPrefs({ ...prefs, lowBattery: Number(e.target.value) })}
                        onPointerUp={() => update({ lowBattery: prefs.lowBattery })}
                        onKeyUp={() => update({ lowBattery: prefs.lowBattery })}
                        step="5"
                        style={{ "--progress": `${((prefs.lowBattery - 5) / 45) * 100}%` } as React.CSSProperties}
                        type="range"
                        value={prefs.lowBattery}
                      />
                    </label>
                  )}

                  <button
                    className="secondary-action"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await sendTestPush(endpoint);
                        setMessage("Notification de test envoyée ✔");
                      })
                    }
                    type="button"
                  >
                    Envoyer une notification de test
                  </button>
                </>
              )}
            </>
          )}
          {message && <p className="notif-message">{message}</p>}
          {error && <p className="configuration-error">{error}</p>}
          <small>Les notifications ne contiennent jamais la position de la voiture.</small>
        </section>
      </div>
    </div>
  );
}
