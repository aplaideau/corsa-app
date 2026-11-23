import { useEffect, useState, type ReactNode } from "react";
import { ApiError, getConsumption, type Consumption } from "./services/vehicleApi";

const fmt1 = (n: number) => n.toLocaleString("fr-BE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("fr-BE", { month: "short" }).format(new Date(`${m}-15T12:00:00`)).replace(".", "");
const monthLong = (m: string) =>
  new Intl.DateTimeFormat("fr-BE", { month: "long", year: "numeric" }).format(new Date(`${m}-15T12:00:00`));
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Graphique de la consommation moyenne par mois (une barre par mois, touche = détail). */
export function MonthlyChart({ monthly }: { monthly: Consumption["monthly"] }) {
  const months = monthly.filter((m) => m.avg !== null);
  const [picked, setPicked] = useState<string | null>(null);
  if (months.length === 0) return null;
  const max = Math.max(20, ...months.map((m) => m.avg as number));
  const top = Math.ceil(max / 5) * 5;
  const pickedMonth = months.find((m) => m.month === picked) ?? months[months.length - 1];
  return (
    <>
                <div className="conso-chart" role="img" aria-label={months.map((m) => `${monthLong(m.month)} : ${fmt1(m.avg as number)} kWh/100 km`).join(", ")}>
                  <div className="conso-grid" style={{ bottom: `calc(22px + (100% - 22px) * ${10 / top})` }}>
                    <span>10</span>
                  </div>
                  <div className="conso-grid" style={{ bottom: `calc(22px + (100% - 22px) * ${20 / top})` }}>
                    <span>20</span>
                  </div>
                  <div className="conso-bars">
                    {months.map((m) => (
                      <button
                        aria-label={`${monthLong(m.month)} : ${fmt1(m.avg as number)} kWh/100 km, ${m.km} km`}
                        aria-pressed={m.month === pickedMonth?.month}
                        className={`conso-bar ${m.month === pickedMonth?.month ? "picked" : ""}`}
                        key={m.month}
                        onClick={() => setPicked(m.month)}
                        type="button"
                      >
                        <span className="conso-track">
                          <i style={{ height: `${((m.avg as number) / top) * 100}%` }} />
                        </span>
                        <span>{monthLabel(m.month)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {pickedMonth && (
                  <p className="conso-detail">
                    <strong>{monthLong(pickedMonth.month)}</strong> · {fmt1(pickedMonth.avg as number)} kWh/100 km ·{" "}
                    {pickedMonth.km} km · {pickedMonth.trips} trajet{pickedMonth.trips > 1 ? "s" : ""}
                  </p>
                )}
    </>
  );
}

/** Écran « Consommation » : moyenne 30 jours, autonomie réelle, moyenne par mois, derniers trajets. */
export function ConsumptionScreen({ backIcon, closeIcon, onClose }: { backIcon: ReactNode; closeIcon: ReactNode; onClose: () => void }) {
  const [data, setData] = useState<Consumption | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConsumption()
      .then((d) => {
        setData(d);
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 0 ? "Serveur injoignable" : "Historique des trajets indisponible"));
  }, []);

  const months = data?.monthly.filter((m) => m.avg !== null) ?? [];
  const ref = data?.last30.avg ?? null;

  return (
    <div className="configuration-screen">
      <div className="configuration-shell">
        <header className="configuration-header">
          <button aria-label="Retour" onClick={onClose} type="button">
            {backIcon}
          </button>
          <div>
            <span className="section-label">OPEL CORSA-E</span>
            <h2>Consommation</h2>
          </div>
          <button aria-label="Fermer" onClick={onClose} type="button">
            {closeIcon}
          </button>
        </header>

        {error ? (
          <section className="configuration-card notif-card">
            <h3>{error}</h3>
            <p>Impossible de lire l’historique des trajets pour l’instant.</p>
          </section>
        ) : !data ? (
          <section className="configuration-card notif-card">
            <p>Chargement…</p>
          </section>
        ) : (
          <>
            <section className="configuration-card notif-card conso-hero">
              <span className="section-label">30 DERNIERS JOURS</span>
              {data.last30.avg !== null ? (
                <>
                  <div className="conso-big">
                    {fmt1(data.last30.avg)} <small>kWh/100 km</small>
                  </div>
                  <p>
                    {data.rangeKm !== null && (
                      <>
                        Autonomie réelle à ce rythme : <strong>≈ {data.rangeKm} km</strong>
                        <br />
                      </>
                    )}
                    <span className="muted">
                      {data.last30.km} km sur {data.last30.trips} trajet{data.last30.trips > 1 ? "s" : ""}
                      {data.soh ? ` · batterie à ${Math.round(data.soh)} %` : ""}
                    </span>
                  </p>
                </>
              ) : (
                <p>Pas encore assez de trajets (au moins 20 km sur 30 jours).</p>
              )}
            </section>

            {months.length > 0 && (
              <section className="configuration-card notif-card">
                <h3>Consommation moyenne par mois</h3>
                <p className="muted small">kWh/100 km · touchez un mois pour le détail</p>
                <MonthlyChart monthly={data.monthly} />
              </section>
            )}

            <section className="configuration-card notif-card">
              <h3>Derniers trajets</h3>
              {data.recent.length === 0 ? (
                <p className="muted">Aucun trajet enregistré pour l’instant.</p>
              ) : (
                <ul className="conso-trips">
                  {data.recent.map((t) => {
                    const diff = ref && t.avg !== null ? (t.avg - ref) / ref : 0;
                    const tag = t.avg === null ? "trop court" : diff <= -0.1 ? "économe" : diff >= 0.1 ? "gourmand" : "";
                    return (
                      <li key={t.at}>
                        <div>
                          <strong>{dayLabel(t.at)}</strong>
                          <span className="muted small">
                            {fmt1(t.km)} km · {t.minutes} min
                          </span>
                        </div>
                        <div className="conso-trip-value">
                          <strong>{t.avg !== null ? fmt1(t.avg) : "—"}</strong>
                          {tag && <span className={`conso-tag ${tag === "gourmand" ? "high" : tag === "économe" ? "low" : ""}`}>{tag}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="muted small">
                Trajets des locations compris (kilomètres et consommation ; le parcours est effacé).
                {data.since ? ` Historique depuis le ${new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "long" }).format(new Date(data.since))}.` : ""}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
