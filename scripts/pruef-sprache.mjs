/**
 * Prüft das Wörterbuch gegen das echte Spiel.
 *
 * WOGEGEN DAS SCHÜTZT
 * Der englische Text IST der Schlüssel (siehe src/systems/Sprache.js). Das
 * macht das Wörterbuch lesbar, hat aber eine Kehrseite: ändert jemand einen
 * englischen Satz im HTML — und sei es nur ein Komma —, findet der Eintrag
 * ihn nicht mehr. Die Folge ist still: an dieser einen Stelle steht dann
 * Englisch, mitten im deutschen Menü. Niemand bemerkt das, ausser er spielt
 * das Spiel auf Deutsch durch.
 *
 * Zwei Richtungen werden geprüft:
 *   VERWAIST   — ein Eintrag zeigt auf einen Text, den es nirgends mehr
 *                gibt. Fast immer eine geänderte Formulierung. FEHLER.
 *   OFFEN      — ein sichtbarer Text hat keine Übersetzung. Kein Fehler
 *                (Englisch ist die Rückfallebene), aber eine Liste, die man
 *                gesehen haben will.
 */

import fs from 'node:fs';

/**
 * HTML-Entities auflösen.
 *
 * PFLICHT, NICHT KOSMETIK. Im Quelltext steht `Privacy &amp; data`, im
 * Browser steht dort `Privacy & data` — und genau diesen zweiten Text
 * bekommt das Wörterbuch zur Laufzeit zu sehen. Ohne diese Auflösung meldete
 * der erste Durchlauf dieses Skripts den völlig gesunden Eintrag
 * "Privacy & data" als verwaist und verlangte gleichzeitig eine Übersetzung
 * für "Privacy &amp; data". Beides falsch, beides derselbe Grund.
 */
const entschluesseln = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    /* `&amp;` ZULETZT, sonst würde aus `&amp;nbsp;` erst `&nbsp;` und
     * daraus dann ein Leerzeichen — aus einem angezeigten "&nbsp;" würde
     * stillschweigend etwas anderes. */
    .replace(/&amp;/g, '&');

/**
 * Leerraum vereinheitlichen — genauso wie zur Laufzeit.
 *
 * `\s` schliesst in JavaScript das geschützte Leerzeichen ( ) ein; die
 * Zeile im Spiel ("— pause &nbsp;·&nbsp;") wird dadurch beidseitig gleich
 * behandelt.
 */
const glatt = (s) => entschluesseln(s).replace(/\s+/g, ' ').trim();

/* ------------------------------------------------- Wörterbuch einlesen */

const quelle = fs.readFileSync('src/systems/Sprache.js', 'utf8');
const { SPRACHEN } = await import('../src/systems/Sprache.js');
const sprachen = SPRACHEN.filter((s) => s.woerter);

/* --------------------------------------------- Texte des Spiels sammeln */

const html = fs.readFileSync('index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/** Sichtbare Textknoten aus dem HTML. */
const ausHtml = new Set(
  [...html.matchAll(/>([^<]+)</g)]
    .map((m) => glatt(m[1]))
    .filter((t) => /[A-Za-z]{2}/.test(t)),
);

/** Übersetzbare Attribute. */
for (const m of html.matchAll(/(?:placeholder|aria-label)="([^"]+)"/g)) {
  ausHtml.add(glatt(m[1]));
}

/**
 * Texte, die im JavaScript stehen.
 *
 * Grob, aber für diesen Zweck genau genug: gesucht wird jede Zeichenkette,
 * die auch im Wörterbuch steht. Der Test ist damit "kommt der Schlüssel im
 * Quelltext vor", nicht "ist es wirklich ein Anzeigetext" — beides würde
 * dieselben verwaisten Einträge finden.
 */
const jsQuelle = ['src/ui/UI.js', 'src/core/Game.js', 'src/systems/Konto.js',
  'src/systems/Bestenliste.js', 'src/systems/Fortschritt.js']
  .map((p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

/* ------------------------------------------------------------- Prüfung */

let fehler = 0;

for (const sprache of sprachen) {
  const schluessel = Object.keys(sprache.woerter);
  const verwaist = [];
  for (const k of schluessel) {
    /* Im HTML als vollständiger Textknoten, ODER irgendwo im JavaScript als
     * Zeichenkette. Beides zählt — ein Eintrag darf aus jeder Ecke bedient
     * werden. */
    if (ausHtml.has(k)) continue;
    if (jsQuelle.includes(k)) continue;
    verwaist.push(k);
  }

  const offen = [...ausHtml].filter(
    (t) =>
      !sprache.woerter[t] &&
      // Eigennamen und Zahlenfelder brauchen keine Übersetzung.
      !/^(Jungle Climber|JUNGLE|CLIMBER|II|APE|0000|A|D|P|F1|Esc)$/.test(t) &&
      !/@/.test(t),
  );

  console.log(`\n=== ${sprache.name} (${sprache.code}) ===`);
  console.log(`  ${schluessel.length} Einträge, ${verwaist.length} verwaist, ${offen.length} offen`);

  if (verwaist.length) {
    fehler += verwaist.length;
    console.log('\n  VERWAIST — Eintrag zeigt auf einen Text, den es nicht mehr gibt:');
    for (const k of verwaist) console.log(`    ✗ ${JSON.stringify(k.slice(0, 70))}`);
  }
  if (offen.length) {
    console.log('\n  OFFEN — sichtbar, aber ohne Übersetzung (bleibt englisch):');
    for (const t of offen) console.log(`    · ${JSON.stringify(t.slice(0, 70))}`);
  }
}

/* Ein Wörterbuch, das sich selbst widerspricht: derselbe Schlüssel zweimal.
 * JavaScript nimmt stillschweigend den letzten — die erste Übersetzung wäre
 * wirkungslos, ohne dass irgendetwas meckert. */
for (const sprache of sprachen) {
  const roh = quelle.match(
    new RegExp(`const ${sprache.code.toUpperCase()} = \\{([\\s\\S]*?)\\n\\};`),
  )?.[1];
  if (!roh) continue;
  const zaehler = new Map();
  for (const m of roh.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|([A-Za-z]\w*)):/gm)) {
    const k = m[1] ?? m[2];
    zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
  }
  const doppelt = [...zaehler].filter(([, n]) => n > 1);
  if (doppelt.length) {
    fehler += doppelt.length;
    console.log(`\n  DOPPELT in ${sprache.code} — der zweite gewinnt stillschweigend:`);
    for (const [k, n] of doppelt) console.log(`    ✗ ${JSON.stringify(k)} (${n}x)`);
  }
}

console.log(fehler ? `\n${fehler} Fehler.` : '\nWörterbuch stimmt mit dem Spiel überein.');
process.exit(fehler ? 1 : 0);
