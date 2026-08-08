/**
 * Zerlegt ein Bewegungsvideo in freigestellte Einzelbilder — ohne Browser.
 *
 * Run mit:
 *   node scripts/video-frames.mjs <video.mp4> <zielordner> [--frames 12]
 *
 * LÖST scripts/video-to-frames.mjs AB. Jenes Skript dekodierte im Browser,
 * weil es kein ffmpeg gab; das war fehleranfällig (der Tab musste sichtbar
 * sein, sonst lieferte jedes Springen dasselbe Bild) und langsam. Seit
 * `ffmpeg-static` als Abhängigkeit dabei ist, geht es direkt hier.
 *
 * Die Freistellung ist dieselbe wie vorher, nur in Node statt im Browser:
 *
 *   Kennwert = max(Buntheit, Aufhellung)
 *
 * Wand UND Schatten sind neutrales Grau; die Figur ist entweder bunt oder
 * heller als die Wand, und ein Schatten ist nie bunter. Ein blosser
 * Farbabstand trennt beides nicht — beim orangen Affen lag der Schlagschatten
 * weiter von der Wand entfernt als manche Stelle der Figur.
 *
 * Danach: vom Rand fluten (nur von aussen Erreichbares ist Hintergrund),
 * eingeschlossene Wandflächen ab einer Mindestgrösse ebenfalls freigeben,
 * Grau-Saum herausrechnen, auf die Silhouette zuschneiden und mittig auf eine
 * für ALLE Bilder gemeinsame Leinwand legen.
 *
 * Es werden nur SICHTBAR VERSCHIEDENE Bilder geschrieben: die Videos laufen
 * mit 24 fps, aber die Bewegung darin ist gröber. Wer stur gleichmässig
 * abtastet, bekommt Wiederholungen, und die Animation hakt.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/* ------------------------------------------------------------- Argumente */

const [, , videoArg, zielArg] = process.argv;
if (!videoArg || !zielArg) {
  console.error('Aufruf: node scripts/video-frames.mjs <video.mp4> <zielordner> [--frames 12]');
  process.exit(1);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? Number(process.argv[i + 1]) : fallback;
};

const VIDEO = resolve(videoArg);
const ZIEL = resolve(ROOT, 'assets-src/art', zielArg);
const WUNSCH = arg('frames', 12);
/** Ab dieser Änderung gilt ein Bild als neu (Skala: mittlerer Kanalabstand). */
const MIN_ABSTAND = arg('abstand', 2.5);

/** Bilder je Sekunde des Videos — für die Tempoangabe am Ende. */
const FPS = arg('fps', 24);

/* GENAU EIN ZYKLUS statt "sichtbar verschiedene Bilder".
 *
 * HIER LAG EIN FEHLER, der jede Kletteranimation ruiniert hat, und zwar
 * unabhängig davon, wie das Tempo eingestellt war.
 *
 * Die Vorlagen enthalten nicht EINE Bewegung, sondern die Bewegung mehrfach
 * hintereinander — das gemessene Beispiel hatte in 5,04 Sekunden sechs
 * vollständige Kletterzyklen. Der alte Lauf sammelte über das GESAMTE Video
 * alle "sichtbar verschiedenen" Bilder und dünnte sie dann gleichmässig auf
 * zwölf aus. Damit stammten die zwölf Bilder aus sechs verschiedenen Zyklen:
 * Bild 3 war nicht der Nachfolger von Bild 2, sondern die gleiche Pose eine
 * Bewegung später. Aneinandergereiht ergibt das keine Bewegung, sondern ein
 * Zucken — und es liest sich als "viel zu schnell", weil in jedem Bildwechsel
 * ein ganzer Zyklussprung steckt. Kein Tempowert der Welt repariert das.
 *
 * Mit --zyklus wird stattdessen die Periode gemessen (Autokorrelation über
 * die Rohbilder), die sauberste Wiederholung gesucht und GENAU DIESE
 * lückenlos übernommen. Ergebnis: eine echte, geschlossene Schleife, deren
 * Tempo direkt aus dem Video folgt (Zyklen/Sekunde = fps / Periode).
 */
const ZYKLUS = process.argv.includes('--zyklus');

if (!existsSync(VIDEO)) {
  console.error(`Video nicht gefunden: ${VIDEO}`);
  process.exit(1);
}

/* --------------------------------------------------- Rohbilder mit ffmpeg */

const ROH = resolve(ROOT, 'assets-src/art/_roh');
rmSync(ROH, { recursive: true, force: true });
mkdirSync(ROH, { recursive: true });

console.log(`Video:  ${VIDEO}`);
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', VIDEO, `${ROH}/f_%04d.png`]);

const roh = readdirSync(ROH).filter((f) => f.endsWith('.png')).sort();
console.log(`        ${roh.length} Rohbilder entpackt`);

/* ------------------------------------------------------------ Freistellen */

const LO = 22;
const HI = 45;
const SPERRE = 0.3;
const MIN_LUECKE = 300;
const DESPILL_AB = 0.35;

const klemm = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Hintergrundfarbe aus dem Bildrand (Median). */
function bgFarbe(d, w, h, ch) {
  const rs = [], gs = [], bs = [];
  const nimm = (x, y) => {
    const i = (y * w + x) * ch;
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
  };
  for (let x = 0; x < w; x += 4) { nimm(x, 0); nimm(x, h - 1); }
  for (let y = 0; y < h; y += 4) { nimm(0, y); nimm(w - 1, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

/** Stellt ein Rohbild frei und gibt RGBA zurück. */
async function freistellen(datei) {
  const { data, info } = await sharp(datei).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels, n = w * h;
  const [br, bg_, bb] = bgFarbe(data, w, h, ch);
  const wandHell = (br + bg_ + bb) / 3;

  /* HELLIGKEIT IN BEIDE RICHTUNGEN — mit einem Freibetrag nach unten.
   *
   * HIER STAND EINE RICHTUNGSANNAHME, und die hat sichtbaren Schaden
   * angerichtet. Die Regel lautete: bei grauer Wand ist die Figur HELLER,
   * bei weisser DUNKLER. Sie stimmt, solange die Figur flach ausgeleuchtet
   * ist. Die neuen Kletter- und Chilivideos sind es nicht — der Affe wird
   * von der Seite angestrahlt, und seine Schattenseite ist DUNKLER als die
   * graue Wand. Für die galt dann nur noch die Buntheit, und dunkelbraunes
   * Fell im Schatten ist kaum bunt.
   *
   * Gemessen am fertigen Bild: 14.4 % der Figur waren halbdurchsichtig
   * (beim Goldaffen aus einem flach beleuchteten Video: 2.7 %). Im Spiel sah
   * das aus wie ein zerfressener, verpixelter Kopf mit Löchern im Rumpf.
   *
   * Beide Richtungen bedingungslos zu nehmen geht aber auch nicht: der
   * SCHLAGSCHATTEN auf der Wand ist ebenfalls dunkler und würde damit zum
   * Inhalt. Gemessen an einem Rohbild lassen sich die beiden sauber
   * trennen:
   *
   *   Schlagschatten   Buntheit  0-6,  dunkler um   0-20   (neutrales Grau)
   *   Fell im Schatten Buntheit 18-36, dunkler um  60-120  (braun)
   *
   * Nach unten gilt deshalb ein Freibetrag: die ersten `SCHATTEN` Stufen
   * Dunkelheit zählen nicht. Ein weicher Schatten fällt darunter, eine
   * beschattete Flanke weit darüber. Nach oben gibt es keinen Freibetrag —
   * heller als der Hintergrund wird nichts ausser der Figur. */
  const SCHATTEN = 26;

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const m = (r + g + b) / 3;
    const dr = r - m, dg = g - m, db = b - m;
    const buntheit = Math.sqrt(dr * dr + dg * dg + db * db);
    const heller = m - wandHell;
    const abstandHell = heller >= 0 ? heller : Math.max(0, -heller - SCHATTEN);
    const k = Math.max(buntheit, abstandHell);
    alpha[i] = k <= LO ? 0 : k >= HI ? 1 : (k - LO) / (HI - LO);
  }

  // Vom Rand fluten
  const hg = new Uint8Array(n);
  const stapel = new Int32Array(n);
  let sp = 0;
  for (let x = 0; x < w; x++) { stapel[sp++] = x; stapel[sp++] = (h - 1) * w + x; }
  for (let y = 0; y < h; y++) { stapel[sp++] = y * w; stapel[sp++] = y * w + w - 1; }
  while (sp > 0) {
    const i = stapel[--sp];
    if (hg[i] || alpha[i] >= SPERRE) continue;
    hg[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stapel[sp++] = i - 1;
    if (x < w - 1) stapel[sp++] = i + 1;
    if (y > 0) stapel[sp++] = i - w;
    if (y < h - 1) stapel[sp++] = i + w;
  }

  // Eingeschlossene Wandflächen ab MIN_LUECKE ebenfalls freigeben
  const gesehen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (gesehen[start] || hg[start] || alpha[start] >= SPERRE) continue;
    const gruppe = [];
    const st = [start];
    gesehen[start] = 1;
    while (st.length) {
      const i = st.pop();
      gruppe.push(i);
      const x = i % w, y = (i / w) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) if (!gesehen[j] && !hg[j] && alpha[j] < SPERRE) { gesehen[j] = 1; st.push(j); }
    }
    if (gruppe.length >= MIN_LUECKE) for (const i of gruppe) hg[i] = 1;
  }

  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * ch, q = i * 4;
    const a = hg[i] ? alpha[i] : 1;
    let r = data[p], g = data[p + 1], b = data[p + 2];
    if (a >= DESPILL_AB && a < 1) {
      r = klemm((r - (1 - a) * br) / a);
      g = klemm((g - (1 - a) * bg_) / a);
      b = klemm((b - (1 - a) * bb) / a);
    }
    rgba[q] = r; rgba[q + 1] = g; rgba[q + 2] = b; rgba[q + 3] = Math.round(a * 255);
  }
  return { rgba, w, h };
}

/** Mittlerer Kanalabstand zweier Bilder, grob gerastert. */
function abstand(a, b, w, h) {
  const schritt = Math.max(1, Math.floor(w / 96));
  let s = 0, n = 0;
  for (let y = 0; y < h; y += schritt) {
    for (let x = 0; x < w; x += schritt) {
      const i = (y * w + x) * 4;
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
           Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
      n += 4;
    }
  }
  return s / n;
}

/* ------------------------------------------------------------------ Lauf */

/** Graustufen-Miniatur eines Rohbildes — Grundlage der Periodenmessung. */
async function miniatur(datei) {
  return sharp(datei).resize(120, 120, { fit: 'fill' }).greyscale().raw().toBuffer();
}

/** Mittlerer Abstand zweier Miniaturen. */
function miniAbstand(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * Sucht die Bewegungsperiode und die sauberste Wiederholung darin.
 *
 * Die Periode ist der Versatz, bei dem sich das Video im Mittel am ähnlichsten
 * ist. Der Startpunkt ist danach jene Stelle, an der Anfang und Ende der
 * Periode am besten zusammenpassen — dort schliesst die Schleife am
 * unauffälligsten.
 */
async function periodeFinden(dateien) {
  const mini = [];
  for (const f of dateien) mini.push(await miniatur(resolve(ROH, f)));

  const obergrenze = Math.min(48, Math.floor(mini.length / 2));
  if (obergrenze < 8) {
    throw new Error(`Video zu kurz für --zyklus: ${mini.length} Bilder, gebraucht werden mindestens 16.`);
  }

  /* WIEVIEL SICH ÜBERHAUPT BEWEGT — als Massstab.
   *
   * Die reine Ähnlichkeit reicht als Kriterium NICHT: ein Abschnitt, in dem
   * sich gar nichts tut, ist sich selbst maximal ähnlich und gewinnt jeden
   * solchen Vergleich. Bei einer Vorlage mit ruhigem Vor- oder Nachspann
   * schnitte man so ausgerechnet den Stillstand als "Zyklus" heraus.
   *
   * Deshalb wird die Ähnlichkeit ins Verhältnis zur Bewegung INNERHALB des
   * Fensters gesetzt: gesucht ist der Abschnitt, der sich gut schliesst UND
   * in dem etwas passiert. */
  const bewegung = (von, p) => {
    let s = 0;
    for (let i = von; i < von + p && i + 1 < mini.length; i++) s += miniAbstand(mini[i], mini[i + 1]);
    return s / p;
  };
  const gesamtBewegung = bewegung(0, mini.length - 1);
  const MINDEST_BEWEGUNG = gesamtBewegung * 0.5;

  let beste = null;
  for (let p = 8; p <= obergrenze; p++) {
    let s = 0, n = 0;
    for (let i = 0; i + p < mini.length; i++) { s += miniAbstand(mini[i], mini[i + p]); n++; }
    const mittel = s / n;
    if (!beste || mittel < beste.mittel) beste = { p, mittel };
  }

  let start = null;
  for (let s = 0; s + beste.p < mini.length; s++) {
    if (bewegung(s, beste.p) < MINDEST_BEWEGUNG) continue; // Stillstand überspringen
    const d = miniAbstand(mini[s], mini[s + beste.p]);
    if (!start || d < start.d) start = { s, d };
  }
  if (!start) {
    throw new Error('Kein Abschnitt mit genug Bewegung gefunden — ist das wirklich eine Bewegungsvorlage?');
  }
  return { periode: beste.p, start: start.s };
}

const behalten = [];
/** Länge der Periode in ROHBILDERN — bestimmt das Tempo, nicht die Bildzahl. */
let periodeRoh = 0;

/* ABSPIELREIHENFOLGE mit Wiederholungen.
 *
 * Die Vorlagen laufen mit 24 Bildern je Sekunde, die Bewegung darin ist
 * gröber: im gemessenen Kletterzyklus sind 5 von 19 Rohbildern reine
 * Wiederholungen der vorherigen Pose. Als DATEI sind sie überflüssig — als
 * TAKT sind sie es nicht. Wer sie weglässt und den Rest gleichmässig
 * abspielt, verschiebt die Standzeiten: gemessen wurden danach Schrittweiten
 * zwischen 2.6 und 21.1 statt einer gleichmässigen Bewegung.
 *
 * Deshalb werden nur die verschiedenen Posen geschrieben, und diese Liste
 * hält fest, welche Pose in welchem Takt zu sehen ist. Sie gehört nach
 * CONFIG.sprite.frames bzw. in den Charakter — das Feld nimmt seit jeher eine
 * beliebige Reihenfolge entgegen, Wiederholungen eingeschlossen. */
const reihenfolge = [];

if (ZYKLUS) {
  const { periode, start } = await periodeFinden(roh);
  periodeRoh = periode;
  console.log(`        Periode ${periode} Bilder (${(periode / FPS).toFixed(3)} s), ` +
    `sauberste Wiederholung ab Rohbild ${start + 1}`);

  /* DOPPELBILDER RAUS.
   *
   * Die Vorlagen laufen mit 24 Bildern je Sekunde, die Figur darin bewegt
   * sich aber gröber — mehrere aufeinanderfolgende Rohbilder sind identisch.
   * Im gemessenen Kletterzyklus waren 5 von 19 Bildern reine Wiederholungen.
   * Übernimmt man sie, hält die Bewegung fünfmal je Durchlauf kurz an: der
   * Affe zuckt, statt zu klettern. Genau das war als "die Animation ist nicht
   * stimmig" zu sehen.
   *
   * WICHTIG: Für das TEMPO zählt weiter die Periode in ROHBILDERN. Der Zyklus
   * dauert unverändert periode/FPS Sekunden — er besteht nur aus weniger,
   * dafür wirklich verschiedenen Posen. Wer stattdessen durch die Zahl der
   * behaltenen Bilder teilt, macht die Bewegung ungewollt langsamer. */
  const SCHWELLE = 0.6; // mittlerer Kanalabstand; darunter ist es dasselbe Bild
  let vorheriges = null;
  for (let i = 0; i < periode; i++) {
    const bild = await freistellen(resolve(ROH, roh[start + i]));
    if (vorheriges && abstand(vorheriges.rgba, bild.rgba, bild.w, bild.h) < SCHWELLE) {
      // Dieselbe Pose noch einmal: keine neue Datei, aber ein weiterer Takt.
      reihenfolge.push(behalten.length - 1);
      continue;
    }
    vorheriges = bild;
    behalten.push(bild);
    reihenfolge.push(behalten.length - 1);
  }
  /* Auch der Rücksprung darf kein Doppelbild sein: ist das letzte Bild gleich
   * dem ersten, zeigt die Schleife dieselbe Pose zweimal hintereinander. */
  if (behalten.length > 2) {
    const a = behalten[0], z = behalten[behalten.length - 1];
    if (abstand(a.rgba, z.rgba, a.w, a.h) < SCHWELLE) {
      behalten.pop();
      for (let i = 0; i < reihenfolge.length; i++) {
        if (reihenfolge[i] === behalten.length) reihenfolge[i] = 0;
      }
    }
  }
  const doppelt = reihenfolge.length - behalten.length;
  if (doppelt) {
    console.log(`        ${behalten.length} verschiedene Posen, ${doppelt} davon werden ` +
      `zweimal gehalten (Standzeiten wie im Video)`);
  }
} else {
  let letztes = null;
  for (const f of roh) {
    const bild = await freistellen(resolve(ROH, f));
    if (letztes && abstand(letztes.rgba, bild.rgba, bild.w, bild.h) < MIN_ABSTAND) continue;
    letztes = bild;
    behalten.push(bild);
  }
  console.log(`        ${behalten.length} sichtbar verschiedene Bilder`);
}

/* Auswahl. Im Zyklusmodus bleibt JEDES Bild der Periode erhalten — dünnt man
 * eine Bewegung aus, verliert sie genau die Zwischenposen, die sie flüssig
 * machen. Nur der alte Modus reduziert auf WUNSCH Stück. */
let gewaehlt;
if (ZYKLUS) {
  gewaehlt = behalten;
} else {
  const anzahl = Math.min(WUNSCH, behalten.length);
  const schritt = behalten.length / anzahl;
  gewaehlt = [];
  for (let i = 0; i < anzahl; i++) gewaehlt.push(behalten[Math.floor(i * schritt)]);
}

// Bounding-Box je Bild.
const boxen = gewaehlt.map(({ rgba, w, h }) => {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] > 24) {
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { left: minX, top: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
});

const pad = 6;

/* AUSSCHNITT: gemeinsam statt je Bild.
 *
 * Wird jedes Bild einzeln auf seine eigene Silhouette zugeschnitten und dann
 * zentriert, verschiebt sich die Figur bei jedem Bildwechsel — streckt der
 * Affe den Arm nach oben, wächst seine Box nach oben, und das Zentrieren
 * schiebt den ganzen Körper nach unten. Im Ergebnis wackelt der Kopf, obwohl
 * er in der Vorlage still steht.
 *
 * Im Zyklusmodus wird deshalb EIN Fenster über alle Bilder gelegt (die
 * Vereinigung aller Boxen). Die Bilder bleiben zueinander in Deckung, und die
 * Bewegung ist die aus dem Video — nicht die des Zuschnitts. */
const gemeinsam = ZYKLUS ? {
  left: Math.min(...boxen.map((b) => b.left)),
  top: Math.min(...boxen.map((b) => b.top)),
  right: Math.max(...boxen.map((b) => b.left + b.w)),
  unten: Math.max(...boxen.map((b) => b.top + b.h)),
} : null;

const leinwandW = (gemeinsam ? gemeinsam.right - gemeinsam.left : Math.max(...boxen.map((b) => b.w))) + pad * 2;
const leinwandH = (gemeinsam ? gemeinsam.unten - gemeinsam.top : Math.max(...boxen.map((b) => b.h))) + pad * 2;

rmSync(ZIEL, { recursive: true, force: true });
mkdirSync(ZIEL, { recursive: true });

for (let i = 0; i < gewaehlt.length; i++) {
  const { rgba, w, h } = gewaehlt[i];
  const b = gemeinsam
    ? { left: gemeinsam.left, top: gemeinsam.top, w: gemeinsam.right - gemeinsam.left, h: gemeinsam.unten - gemeinsam.top }
    : boxen[i];
  const cut = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: b.left, top: b.top, width: b.w, height: b.h })
    .png()
    .toBuffer();

  await sharp({
    create: { width: leinwandW, height: leinwandH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: cut, left: Math.round((leinwandW - b.w) / 2), top: Math.round((leinwandH - b.h) / 2) }])
    .png()
    .toFile(resolve(ZIEL, `f_${String(i).padStart(2, '0')}.png`));
}

rmSync(ROH, { recursive: true, force: true });

console.log(`Ziel:   ${ZIEL}`);
console.log(`        ${gewaehlt.length} Bilder, je ${leinwandW}x${leinwandH}` +
  (!ZYKLUS && gewaehlt.length < WUNSCH ? `  (statt ${WUNSCH} — mehr gibt das Video nicht her)` : ''));
if (ZYKLUS) {
  /* Der Takt folgt der PERIODE, nicht der Dateizahl — die Bewegung dauert
   * genauso lange wie im Video, sie braucht nur weniger Dateien. */
  console.log(`TEMPO:  cycleSpeed ${(FPS / reihenfolge.length).toFixed(3)}  ` +
    `(${reihenfolge.length} Takte bei ${FPS} fps = ${(reihenfolge.length / FPS).toFixed(3)} s je Zyklus)`);
  console.log(`FRAMES: [${reihenfolge.join(', ')}]`);
  console.log('        ^ diese Liste nach CONFIG kopieren (frames:) — sie enthält die');
  console.log('          Standzeiten aus dem Video, deshalb stehen Zahlen doppelt drin.');
}
