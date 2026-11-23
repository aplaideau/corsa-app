// Fin de location : demander l'effacement du parcours du locataire dans la base de psa_car_controller.
//
// psacc enregistre pendant les locations (trajets, consommation, recharges = ses vraies données).
// À la fin, l'appli dépose la période dans data/privacy-queue/ (un fichier par location) ; le script système
// deploy/rental-sync.sh (lancé chaque minute) met alors à NULL la latitude, la longitude et
// l'altitude des relevés de cette période, directement dans la base de psacc. Les trajets
// (calculés sur le compteur km et le niveau de batterie) et les recharges restent.
// L'appli, elle, garde un accès en lecture seule à la base.

const fs = require("fs");
const path = require("path");

function createRentalPrivacy({ dataDir, log = console }) {
  const queueDir = path.join(dataDir, "privacy-queue");

  /** Fin de location : effacer le parcours entre from et to (10 min de marge de chaque côté). */
  function rentalEnded({ from, to = new Date() }) {
    if (!from) return;
    const job = {
      from: new Date(new Date(from).getTime() - 10 * 60000).toISOString(),
      to: new Date(new Date(to).getTime() + 10 * 60000).toISOString(),
    };
    fs.mkdirSync(queueDir, { recursive: true });
    const file = path.join(queueDir, `${Date.now()}.json`);
    fs.writeFileSync(file + ".tmp", JSON.stringify(job));
    fs.renameSync(file + ".tmp", file);
    log.log("mode location : effacement du parcours programmé");
  }

  return { rentalEnded };
}

module.exports = { createRentalPrivacy };
