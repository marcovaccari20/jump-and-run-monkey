/**
 * Kollision.
 *
 * Bewusst KEINE 3D-Physik: alles läuft als 2D-Test in der Wandebene (x/y).
 * Steine und Affe werden als Kreise geprüft, die AABB-Variante steht für
 * rechteckige Hindernisse bereit, falls später welche dazukommen.
 *
 * Es wird nichts allokiert und nichts zurückgegeben — Treffer werden über
 * Callbacks gemeldet.
 */

/** Kreis gegen Kreis. */
export function circleOverlap(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/** Achsenparalleles Rechteck gegen Rechteck (Mittelpunkt + Halbmasse). */
export function aabbOverlap(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
  return (
    Math.abs(ax - bx) <= ahw + bhw && Math.abs(ay - by) <= ahh + bhh
  );
}

/** Kreis gegen achsenparalleles Rechteck. */
export function circleAabbOverlap(cx, cy, r, bx, by, bhw, bhh) {
  const nearestX = Math.max(bx - bhw, Math.min(cx, bx + bhw));
  const nearestY = Math.max(by - bhh, Math.min(cy, by + bhh));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy <= r * r;
}

export class CollisionSystem {
  /**
   * Prüft den Affen gegen alle aktiven Steine und Bananen.
   *
   * @param {import('../entities/Player.js').Player} player
   * @param {import('./Spawner.js').Spawner} spawner
   * @param {{onRock: (rock:any)=>void, onBanana: (banana:any)=>void}} handlers
   */
  static check(player, spawner, handlers) {
    const px = player.hitX;
    const py = player.hitY;
    const pr = player.hitRadius;

    // Bananen zuerst: wenn Stein und Banane im selben Frame treffen, soll die
    // Wiederbelebung noch gutgeschrieben werden, bevor der Treffer zählt.
    const bananas = spawner.bananas.active;
    for (let i = bananas.length - 1; i >= 0; i--) {
      const banana = bananas[i];
      if (!banana.active) continue;
      if (circleOverlap(px, py, pr, banana.x, banana.y, banana.hitRadius)) {
        handlers.onBanana(banana);
      }
    }

    // Unverwundbar (nach verbrauchter Wiederbelebung) oder bereits tot:
    // Steine ignorieren.
    if (player.isInvulnerable || !player.alive) return;

    const rocks = spawner.rocks.active;
    for (let i = rocks.length - 1; i >= 0; i--) {
      const rock = rocks[i];
      if (!rock.active) continue;
      if (circleOverlap(px, py, pr, rock.x, rock.y, rock.hitRadius)) {
        handlers.onRock(rock);
        return; // ein Treffer pro Frame genügt
      }
    }
  }
}
