/**
 * Macht aus den beiden Boss-Videos Bildfolgen für den Kampf.
 *
 *   npm run prep:bosskampf
 *
 * Quellen (Downloads oder Desktop, erster Treffer gewinnt):
 *   hf_20260812_071232_….mp4   grosser Gorilla, hängt an einer Liane
 *   hf_20260808_114309_….mp4   kleiner Affe, klettert
 *
 * Ziel:
 *   public/boss/gorilla/f_00.webp …    public/boss/affe/f_00.webp …
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WARUM NICHT video-to-frames.mjs
 *
 * Jenes Skript zerlegt im Browser, weil es zu seiner Zeit kein ffmpeg auf
 * diesem Rechner gab. Inzwischen liegt `ffmpeg-static` in den Abhängigkeiten
 * (die Musik- und Klangaufbereitung benutzt es), also geht es direkt und
 * ohne lokalen Server.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FREISTELLEN: SYMMETRISCHER ABSTAND, NICHT "HELLER ALS"
 *
 * prepare-boss.mjs entscheidet über `hellerHintergrund = wandHell > 200` und
 * rechnet dann EINSEITIG: bei dunklem Hintergrund zählt nur, was HELLER ist.
 * Für die beiden Videos hier wäre das fatal — gemessen:
 *
 *     Gorilla   Hintergrund 123,  Motiv bis hinunter auf 3    → dunkler
 *     Affe      Hintergrund 250,  Motiv bis hinunter auf 17   → dunkler
 *
 * Der Gorilla ist dunkler als sein mittelgrauer Hintergrund. Mit der
 * einseitigen Rechnung käme `123 - m` nie über null, die Buntheit eines
 * grauen Gorillas ist ebenfalls nahe null — er wäre komplett wegradiert
 * worden. Hier zählt deshalb der BETRAG des Abstands.
 *
 * Beide Hintergründe sind extrem flach (Randschwankung höchstens 3 von 255),
 * darum reichen enge Schwellen: unter 7 ist sicher Hintergrund, über 22
 * sicher Motiv, dazwischen wird weich geblendet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GEMEINSAMER BILDAUSSCHNITT
 *
 * Jedes Bild einzeln auf seine Silhouette zu beschneiden wäre falsch: der
 * Gorilla schwingt, seine Silhouette ist mal breiter, mal schmaler. Einzeln
 * beschnitten und dann auf gleiche Höhe gebracht, zappelte er im Spiel.
 * Deshalb wird EIN Ausschnitt über alle Bilder gelegt — die Bewegung bleibt
 * darin erhalten.
 *
 * Die obere Hand und die Liane bleiben mit im Bild. Im Spiel sitzt der Boss
 * so hoch, dass beides über dem oberen Bildrand liegt und man nur den
 * hängenden Körper sieht.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HEIM = process.env.USERPROFILE ?? process.env.HOME ?? '';
const QUELLEN = [resolve(HEIM, 'Downloads'), resolve(HEIM, 'Desktop')];
const OUT = resolve(ROOT, 'public/boss');

/* 30 Bilder je Video. Die Vorlagen sind 5.06 s bei 24 fps, also 121 Bilder —
 * die alle mitzunehmen hiesse rund 1.5 MB je Boss für eine Bewegung, die
 * nur schaukelt. Mit 30 Bildern läuft ein Zyklus bei 12 Bildern/s in 2.5 s
 * ab, und das reicht für ein Schwingen vollkommen. */
const BILDER = 30;
const ZIELHOEHE = 384;
const QUALITAET = 82;

const BOSSE = [
  {
    id: 'gorilla',
    datei: 'hf_20260812_071232_c86176c0-865d-47c6-ac32-0a10e7f09c83.mp4',
    was: 'grosser Gorilla — wirft grüne Bananen',
  },
  /* Der kleine Affe stand hier einmal als zweite Boss-Ausführung. Er ist
   * raus: es ist DIESELBE Figur wie die Spielfigur, als Gegner also
   * verwirrend. Sein Video wird jetzt von scripts/prepare-spielerwurf.mjs
   * zur Wurfanimation des SPIELERS verarbeitet. */
];

/* Schwellen des Alphakeils, in Helligkeitsstufen Abstand zum Hintergrund.
 *
 * WAREN 7 UND 22 — VIEL ZU NIEDRIG, und das sah man im Spiel.
 *
 * Der Gorilla wirft im Video einen weichen SCHATTEN auf den grauen
 * Hintergrund. Der ist dunkler als der Hintergrund, lag also über der alten
 * Schwelle und wurde als Motiv behandelt: neben dem Arm stand ein grauer
 * Streifen im Bild, in mehreren Bildern der Folge, und er wanderte mit.
 *
 * Gemessen an Bild 0 (Hintergrund 123), nur graue Pixel, Abstand zum
 * Hintergrund:
 *
 *     Körper    Helligkeit  5..58    ->  Abstand >= 65
 *     Schatten  Helligkeit 65..149   ->  Abstand <= 58
 *
 * Dazwischen liegt ein Tal: die Abstände 10 bis 50 machen zusammen nur rund
 * 1.8 % aller grauen Pixel aus, ab 55 steigt es steil an. Die Schwelle
 * gehört genau dorthin. 42 bis 64 lässt dem Schatten keinen Platz mehr und
 * nimmt vom Fell nichts weg, was man sähe.
 *
 * NEBENWIRKUNG, DIE ERWÜNSCHT IST: der helle Ast am oberen Rand fällt damit
 * ebenfalls weg. Er sollte ohnehin über dem Bildrand liegen. */
const LO = 42;
const HI = 64;
/* Ab diesem Alpha gilt ein Pixel beim Fluten als undurchlässig. */
const SPERRE = 0.3;

function finden(datei) {
  for (const ordner of QUELLEN) {
    const p = join(ordner, datei);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Zerlegt das Video in `BILDER` gleichmässig verteilte PNGs. */
function zerlegen(video, ordner) {
  mkdirSync(ordner, { recursive: true });
  for (const f of readdirSync(ordner)) rmSync(join(ordner, f));
  const r = spawnSync(
    ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      video,
      '-vf',
      `fps=${BILDER}/5.06`,
      '-frames:v',
      String(BILDER),
      join(ordner, 'roh_%03d.png'),
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`ffmpeg: ${(r.stderr || '').slice(-400)}`);
  return readdirSync(ordner)
    .filter((f) => f.startsWith('roh_'))
    .sort()
    .map((f) => join(ordner, f));
}

/**
 * Alphakanal aus dem Abstand zur Hintergrundfarbe.
 * Gibt RGBA plus die Silhouettengrenzen dieses einen Bildes zurück.
 */
async function freistellen(datei) {
  const { data, info } = await sharp(datei).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const n = w * h;

  // Hintergrundfarbe aus einem schmalen Saum, als Median gegen Ausreisser.
  const proKanal = [[], [], []];
  for (let x = 0; x < w; x += 3) {
    for (const y of [0, 1, h - 2, h - 1]) {
      const i = (y * w + x) * ch;
      for (let k = 0; k < 3; k++) proKanal[k].push(data[i + k]);
    }
  }
  const bg = proKanal.map((v) => {
    v.sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const bgHell = (bg[0] + bg[1] + bg[2]) / 3;

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const m = (r + g + b) / 3;
    // Buntheit: farbige Stellen sind nie der graue/weisse Hintergrund.
    const dr = r - m;
    const dg = g - m;
    const db = b - m;
    const buntheit = Math.sqrt(dr * dr + dg * dg + db * db);
    // BETRAG — das Motiv darf heller ODER dunkler sein als der Hintergrund.
    const abstand = Math.abs(m - bgHell);
    const k = Math.max(buntheit, abstand);
    alpha[i] = k <= LO ? 0 : k >= HI ? 1 : (k - LO) / (HI - LO);
  }

  /* Vom Bildrand fluten. Nur was von aussen erreichbar ist, ist wirklich
   * Hintergrund — graue Stellen INNERHALB des Gorillas bleiben so stehen. */
  const hg = new Uint8Array(n);
  const stapel = new Int32Array(n);
  let sp = 0;
  for (let x = 0; x < w; x++) {
    stapel[sp++] = x;
    stapel[sp++] = (h - 1) * w + x;
  }
  for (let y = 0; y < h; y++) {
    stapel[sp++] = y * w;
    stapel[sp++] = y * w + w - 1;
  }
  while (sp > 0) {
    const i = stapel[--sp];
    if (hg[i] || alpha[i] >= SPERRE) continue;
    hg[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stapel[sp++] = i - 1;
    if (x < w - 1) stapel[sp++] = i + 1;
    if (y > 0) stapel[sp++] = i - w;
    if (y < h - 1) stapel[sp++] = i + w;
  }

  /* EINGESCHLOSSENE HINTERGRUNDFLÄCHEN.
   *
   * Die Flutung oben erreicht nur, was vom Bildrand aus zusammenhängt. Hält
   * der Gorilla den Arm über den Kopf (Bild 22, das Ausholen), entsteht
   * zwischen Arm, Kopf und Körper ein LOCH, das vom Rand aus nicht
   * erreichbar ist. Es bleibt dadurch voll deckend stehen — im Spiel ein
   * heller grauer Fleck mitten in der Figur, den man vor der grünen Wand
   * sofort sieht.
   *
   * Unterschieden wird nach Grösse: ein echtes Loch ist gross, ein Loch aus
   * Bildrauschen klein und soll zugehen. Dieselbe Rechnung wie in
   * scripts/prepare-boss.mjs — sie fehlte hier schlicht. */
  const MIN_LUECKE = Math.max(300, Math.round(n * 0.0004));
  const gesehen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (gesehen[start] || hg[start] || alpha[start] >= SPERRE) continue;
    const gruppe = [];
    const st = [start];
    gesehen[start] = 1;
    while (st.length) {
      const i = st.pop();
      gruppe.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) {
        if (!gesehen[j] && !hg[j] && alpha[j] < SPERRE) {
          gesehen[j] = 1;
          st.push(j);
        }
      }
    }
    if (gruppe.length >= MIN_LUECKE) for (const i of gruppe) hg[i] = 1;
  }

  const rgba = Buffer.alloc(n * 4);
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const q = i * 4;
    const a = hg[i] ? alpha[i] : 1;

    /* DIE HINTERGRUNDFARBE AUS DEM RAND HERAUSRECHNEN.
     *
     * Ein halbdurchsichtiges Randpixel ist im Video eine MISCHUNG aus Fell
     * und Hintergrund:  gesehen = a * fell + (1-a) * hintergrund.
     * Speichert man `gesehen` unverändert und setzt nur das Alpha, bleibt
     * der Hintergrundanteil im Pixel stehen — vor einer grünen Wand sieht
     * man dann einen grauen Saum um die Figur.
     *
     * Nach `fell` aufgelöst:  fell = (gesehen - (1-a) * hintergrund) / a.
     * Unter einem Zehntel Deckkraft wird nicht mehr gerechnet: dort teilt
     * man durch fast null und verstärkt nur noch das Rauschen. */
    if (a > 0.1 && a < 0.98) {
      for (let k = 0; k < 3; k++) {
        const rein = (data[p + k] - (1 - a) * bg[k]) / a;
        rgba[q + k] = Math.max(0, Math.min(255, Math.round(rein)));
      }
    } else {
      rgba[q] = data[p];
      rgba[q + 1] = data[p + 1];
      rgba[q + 2] = data[p + 2];
    }
    rgba[q + 3] = Math.round(a * 255);
    if (a > 0.1) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { rgba, w, h, minX, maxX, minY, maxY };
}

/* ------------------------------------------------------------------- Lauf */

mkdirSync(OUT, { recursive: true });
const bericht = [];

for (const boss of BOSSE) {
  const video = finden(boss.datei);
  if (!video) {
    console.log(`  ÜBERSPRUNGEN  ${boss.id}: ${boss.datei} nirgends gefunden`);
    continue;
  }
  console.log(`\n=== ${boss.id} — ${boss.was}`);
  console.log(`    Quelle: ${video}`);

  const tmp = join(OUT, `_tmp_${boss.id}`);
  const rohBilder = zerlegen(video, tmp);
  console.log(`    ${rohBilder.length} Rohbilder`);

  // Erst alle freistellen, dann den gemeinsamen Ausschnitt bestimmen.
  const frei = [];
  for (const f of rohBilder) frei.push(await freistellen(f));

  const g = {
    minX: Math.min(...frei.map((f) => f.minX)),
    maxX: Math.max(...frei.map((f) => f.maxX)),
    minY: Math.min(...frei.map((f) => f.minY)),
    maxY: Math.max(...frei.map((f) => f.maxY)),
  };
  const bw = g.maxX - g.minX + 1;
  const bh = g.maxY - g.minY + 1;
  console.log(`    gemeinsamer Ausschnitt: ${bw}x${bh} bei (${g.minX},${g.minY})`);

  const zielOrdner = join(OUT, boss.id);
  mkdirSync(zielOrdner, { recursive: true });
  for (const f of readdirSync(zielOrdner)) rmSync(join(zielOrdner, f));

  const breiten = [];
  let summeKB = 0;
  for (let i = 0; i < frei.length; i++) {
    const f = frei[i];
    // Breite der Silhouette DIESES Bildes — verrät, wo der Arm ausholt.
    breiten.push(f.maxX - f.minX + 1);

    const ziel = join(zielOrdner, `f_${String(i).padStart(2, '0')}.webp`);
    const info = await sharp(f.rgba, { raw: { width: f.w, height: f.h, channels: 4 } })
      .extract({ left: g.minX, top: g.minY, width: bw, height: bh })
      .resize({ height: ZIELHOEHE, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: QUALITAET, alphaQuality: 90 })
      .toFile(ziel);
    summeKB += info.size / 1024;
  }

  rmSync(tmp, { recursive: true, force: true });

  /* Wo holt er aus? Das breiteste Bild ist der gestreckte Wurfarm. Diese
   * Zahl gehört als `loslassenBei` in die Konfiguration — gemessen statt
   * geschätzt. */
  const maxBreite = Math.max(...breiten);
  const wurfBild = breiten.indexOf(maxBreite);
  const anteil = wurfBild / breiten.length;

  console.log(`    ${frei.length} Bilder, zusammen ${summeKB.toFixed(0)} KB`);
  console.log(
    `    breitestes Bild: f_${String(wurfBild).padStart(2, '0')} (${maxBreite} px, Schnitt ${Math.round(breiten.reduce((a, b) => a + b, 0) / breiten.length)} px)`,
  );
  console.log(`    -> loslassenBei ≈ ${anteil.toFixed(3)}  (${wurfBild}/${breiten.length})`);

  bericht.push({ id: boss.id, bilder: frei.length, kb: Math.round(summeKB), wurfBild, anteil, bw, bh });
}

writeFileSync(join(OUT, '_bericht.json'), JSON.stringify(bericht, null, 2));
console.log('\nFertig. Zusammenfassung in public/boss/_bericht.json');
console.log('Die gemessenen loslassenBei-Werte gehören nach CONFIG.boss.arten[*].loslassenBei.');
