import { useEffect, useState, type ReactNode } from "react";
import { ApiError, getReleases, type Release } from "./services/vehicleApi";

const formatDate = (day: string) =>
  new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${day}T12:00:00`));

/** Écran « Nouveautés » : historique des versions et leurs notes, en français. */
export function ReleasesScreen({ backIcon, closeIcon, onClose }: { backIcon: ReactNode; closeIcon: ReactNode; onClose: () => void }) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReleases()
      .then((r) => setReleases(r.releases))
      .catch((e) => setError(e instanceof ApiError && e.status === 0 ? "Serveur injoignable" : String(e.message || e)));
  }, []);

  return (
    <div className="configuration-screen">
      <div className="configuration-shell">
        <header className="configuration-header">
          <button aria-label="Retour" onClick={onClose} type="button">
            {backIcon}
          </button>
          <div>
            <span className="section-label">OPEL CORSA-E</span>
            <h2>Nouveautés</h2>
          </div>
          <button aria-label="Fermer" onClick={onClose} type="button">
            {closeIcon}
          </button>
        </header>

        <section className="configuration-card notif-card releases-card">
          {error ? (
            <>
              <h3>{error}</h3>
              <p>Impossible de lire l’historique des versions pour l’instant.</p>
            </>
          ) : releases === null ? (
            <p>Chargement…</p>
          ) : releases.length === 0 ? (
            <p>Aucune note de version pour l’instant.</p>
          ) : (
            releases.map((r) => (
              <article className="release" key={r.version}>
                <header>
                  <strong>{formatDate(r.date)}</strong>
                  {r.installed && <span className="release-badge">Installée</span>}
                  <small>{r.version}</small>
                </header>
                <ul>
                  {r.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
