/**
 * Zerlegt ein Bewegungsvideo in freigestellte Einzelbilder.
 *
 * Es gibt kein ffmpeg auf diesem System — dekodiert wird deshalb im Browser
 * (siehe README, "Kletteranimation aus dem Video"). Dieses Skript startet dafür
 * einen winzigen lokalen Server: er liefert das Video und eine Seite, die es
 * zerlegt, und nimmt die fertigen PNGs per POST wieder entgegen.
 *
 *   node scripts/video-to-frames.mjs probe   <video.mp4> [anzahl]
 *       Schreibt <anzahl> ROHE Stichproben nach assets-src/art/_probe/ —
 *       zum Nachsehen, ob der Hintergrund wirklich weiss ist und was das
 *       Video überhaupt zeigt.
 *
 *   node scripts/video-to-frames.mjs extract <video.mp4> <zielordner> [frames]
 *       Bestimmt die Loop-Länge, tastet genau einen Zyklus mit <frames>
 *       Bildern ab, entfernt das Weiss per Alpha-Keying, schneidet auf die
 *       Silhouette zu und schreibt nach assets-src/art/<zielordner>/.
 *
 * Ab den fertigen PNGs übernimmt `npm run prep:art` (reproduzierbar).
 */
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const [, , modus, videoArg, arg3, arg4] = process.argv;

if (!modus || !videoArg || !['probe', 'extract'].includes(modus)) {
  console.error('Aufruf:');
  console.error('  node scripts/video-to-frames.mjs probe   <video.mp4> [anzahl]');
  console.error('  node scripts/video-to-frames.mjs extract <video.mp4> <zielordner> [frames]');
  process.exit(1);
}

const VIDEO = resolve(videoArg);
if (!existsSync(VIDEO)) {
  console.error(`Video nicht gefunden: ${VIDEO}`);
  process.exit(1);
}

const ZIEL =
  modus === 'probe'
    ? resolve(ROOT, 'assets-src/art/_probe')
    : resolve(ROOT, 'assets-src/art', arg3 ?? 'movement_neu');

const ANZAHL = Number(modus === 'probe' ? (arg3 ?? 8) : (arg4 ?? 12));

// Den Zielordner NICHT vorab leeren. Der eigentliche Lauf passiert im
// Browser — bleibt die Seite in einem Hintergrundtab hängen oder bricht die
// Selbstkontrolle ab, stünde man sonst ohne die alten Bilder da. Überzählige
// Dateien eines früheren, längeren Laufs werden erst am Ende entfernt.
mkdirSync(ZIEL, { recursive: true });

const PORT = 5199;

/* ------------------------------------------------------------------ Seite */

const SEITE = `<!doctype html>
<meta charset="utf-8">
<title>Frame-Extraktion</title>
<style>
  body { font: 14px/1.6 system-ui, sans-serif; background:#111; color:#eee; padding:24px; }
  #log { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size:12px; }
  .ok { color:#7ee787 } .warn { color:#ffa657 }
</style>
<h2>Jungle Climber — Frame-Extraktion</h2>
<div id="log">läuft…</div>
<script type="module">
const MODUS  = ${JSON.stringify(modus)};
const ANZAHL = ${ANZAHL};
const logEl  = document.getElementById('log');
const zeilen = [];
const log = (t, cls='') => {
  zeilen.push(cls ? \`<span class="\${cls}">\${t}</span>\` : t);
  logEl.innerHTML = zeilen.join('\\n');
  // Auch an den Server melden — sonst sieht man von aussen nicht, ob die
  // Seite arbeitet oder in einem gedrosselten Hintergrundtab feststeckt.
  fetch('/log', { method: 'POST', body: t }).catch(() => {});
};

window.addEventListener('error', (e) => {
  fetch('/log', { method: 'POST', body: 'FEHLER: ' + e.message }).catch(() => {});
});
window.addEventListener('unhandledrejection', (e) => {
  fetch('/log', { method: 'POST', body: 'ABBRUCH: ' + (e.reason?.message ?? e.reason) }).catch(() => {});
});

// Das Video MUSS im Dokument hängen und sichtbar sein. Ein loses, nie
// angezeigtes <video>-Element liefert in Chrome beim Springen weiter das
// zuerst dekodierte Bild — alle Stichproben kamen dadurch byte-identisch
// heraus (md5 über alle zwölf gleich).
const video = document.createElement('video');
video.src = '/video';
video.muted = true;
video.playsInline = true;
video.preload = 'auto';
video.controls = true;
video.style.cssText = 'width:240px;display:block;margin:12px 0;background:#000';
document.body.appendChild(video);

await new Promise((ok, fail) => {
  video.onloadedmetadata = ok;
  video.onerror = () => fail(new Error('Video liess sich nicht laden'));
});
// Erste Frame sicher dekodiert bekommen
await new Promise((ok) => { video.onseeked = ok; video.currentTime = 0.001; });

const W = video.videoWidth, H = video.videoHeight, DUR = video.duration;
log(\`Video: \${W}x\${H}, \${DUR.toFixed(3)} s\`);

const cv  = document.createElement('canvas');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d', { willReadFrequently: true });

/**
 * Auf ein Bild springen — und WIRKLICH warten, bis es dekodiert ist.
 *
 * 'seeked' allein genügt nicht: es meldet nur, dass die Position gesetzt
 * wurde, nicht dass der Dekoder das Bild fertig hat. Zeichnet man sofort
 * danach, landet oft noch das VORHERIGE Bild auf der Leinwand. Beim ersten
 * Versuch fiel das nicht auf, weil zwischen den Bildern ein POST lag, der dem
 * Dekoder genug Zeit liess — ohne POST lieferten dann alle 40 Stichproben
 * exakt dasselbe Bild (Abstand 0.0 auf ganzer Linie).
 *
 * requestVideoFrameCallback feuert erst, wenn das Bild tatsächlich anliegt.
 */
const seek = (t) => new Promise((ok) => {
  let fertig = false;
  // Nach dem Bildsignal noch kurz nachlaufen lassen — dann liegt das Bild
  // sicher an, auch wenn requestVideoFrameCallback gar nicht erst feuert
  // (das passiert, wenn der Tab nicht dargestellt wird).
  const schluss = () => { if (!fertig) { fertig = true; setTimeout(ok, 25); } };
  video.onseeked = () => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => schluss());
    setTimeout(schluss, 200); // Sicherheitsnetz
  };
  video.currentTime = Math.min(Math.max(t, 0), Math.max(DUR - 0.001, 0));
});

const grab = async (t) => {
  await seek(t);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(video, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
};

const postPNG = async (name, blob) => {
  await fetch('/frame/' + name, { method: 'POST', body: blob });
};

const toBlob = (canvas) => new Promise((ok) => canvas.toBlob(ok, 'image/png'));

/* ---------- Alpha-Keying gegen eine flache Hintergrundfarbe ------------
 * Das erste Bewegungsvideo (brauner Affe) lief vor REINWEISS, dafür genügte
 * eine Helligkeitsschwelle. Die beiden neuen Videos zeigen den Affen vor
 * einer grauen WAND (gemessen rgb(92,92,92) bzw. rgb(128,127,134)) — und die
 * hat obendrein einen weichen Schlagschatten und einen leichten Verlauf.
 *
 * Deshalb hier allgemeiner: Abstand zur gemessenen Hintergrundfarbe.
 *   dist < LO  -> sicher Hintergrund
 *   dist > HI  -> sicher Figur
 *   dazwischen -> weiche Kante
 *
 * Anschliessend wird von den Bildrändern aus geflutet: nur was vom Rand aus
 * erreichbar ist, gilt wirklich als Hintergrund. Sonst würden helle Stellen
 * INNERHALB der Figur (Fellglanz) fälschlich Löcher reissen.
 */
/* WIE "FIGUR" GEMESSEN WIRD
 *
 * Der naheliegende Weg — schlichter Farbabstand zur Wandfarbe — trägt nicht
 * weit genug. Gemessen an den beiden Videos:
 *
 *   weisses Video   Wand rgb(92,92,92),  Schatten dunkler  -> Abstand ~20–35
 *   oranges Video   Wand rgb(128,127,134), Schatten dunkler -> Abstand ~74
 *
 * Beim orangen Video liegt der Schlagschatten damit WEITER von der Wand
 * entfernt als manche Stelle des Affen. Mit einer einzigen Schwelle ist das
 * nicht zu trennen — der Schatten klebte als graue Wolke neben der Figur.
 *
 * Entscheidend ist nicht die Helligkeit, sondern die FARBIGKEIT: Wand UND
 * Schatten sind neutrales Grau (R≈G≈B), der Affe ist entweder bunt (orange)
 * oder deutlich heller als die Wand (cremeweiss). Ein Schatten ist immer
 * DUNKLER als die Wand, nie bunter. Bewertet wird deshalb
 *
 *     Buntheit  = Abstand von der Grauachse
 *     Aufhellung = Helligkeit minus Wandhelligkeit, nur wenn positiv
 *     Kennwert  = max(Buntheit, Aufhellung)
 *
 * Damit ergibt sich für beide Videos dasselbe Bild: Wand ~0, Schatten ~2,
 * Figur 70–130.
 */
const LO = 22, HI = 45;
// Unter diesem Alpha wird die Farbe NICHT zurückgerechnet: bei a≈0.1
// verstärkt die Division jedes Rauschen zu einem leuchtenden Rand.
const DESPILL_AB = 0.35;

/** Hintergrundfarbe aus dem Bildrand schätzen (Median der Randpixel). */
function bgFarbe(img) {
  const { width: w, height: h, data: d } = img;
  const rs = [], gs = [], bs = [];
  const nimm = (x, y) => {
    const i = (y * w + x) * 4;
    rs.push(d[i]); gs.push(d[i+1]); bs.push(d[i+2]);
  };
  for (let x = 0; x < w; x += 4) { nimm(x, 0); nimm(x, h - 1); }
  for (let y = 0; y < h; y += 4) { nimm(0, y); nimm(w - 1, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

function keyFlatBg(img) {
  const { width: w, height: h, data: d } = img;
  const [br, bg_, bb] = bgFarbe(img);
  const n = w * h;

  // 1) Rohes Alpha aus Buntheit und Aufhellung (siehe Erläuterung oben)
  const wandHell = (br + bg_ + bb) / 3;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const r = d[p], g = d[p+1], b = d[p+2];
    const m = (r + g + b) / 3;
    const dr = r - m, dg = g - m, db = b - m;
    const buntheit = Math.sqrt(dr*dr + dg*dg + db*db);
    const aufhellung = m - wandHell; // negativ = dunkler als die Wand = Schatten
    const kennwert = Math.max(buntheit, aufhellung);
    alpha[i] = kennwert <= LO ? 0 : kennwert >= HI ? 1 : (kennwert - LO) / (HI - LO);
  }

  // 2) Vom Rand fluten: echter Hintergrund ist nur, was von aussen erreichbar
  //    ist. Alles andere (Löcher in der Figur) wird wieder deckend.
  const hg = new Uint8Array(n);
  const stapel = [];
  for (let x = 0; x < w; x++) { stapel.push(x); stapel.push((h-1)*w + x); }
  for (let y = 0; y < h; y++) { stapel.push(y*w); stapel.push(y*w + w - 1); }
  // Die Flutung wird schon von TEILWEISE deckenden Pixeln aufgehalten, nicht
  // erst von voll deckenden. Sonst frisst sie sich durch schattige
  // Körperstellen (der abgewandte Arm liegt im Schatten) und legt sie frei —
  // im Spiel schienen dort die Blätter durch den Arm. Der weiche Fellsaum
  // liegt unter dieser Schwelle und bleibt damit schön weich.
  const SPERRE = 0.3;
  while (stapel.length) {
    const i = stapel.pop();
    if (hg[i] || alpha[i] >= SPERRE) continue;
    hg[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0)     stapel.push(i - 1);
    if (x < w - 1) stapel.push(i + 1);
    if (y > 0)     stapel.push(i - w);
    if (y < h - 1) stapel.push(i + w);
  }

  // 2b) EINGESCHLOSSENE Wandflächen.
  //     Zwischen Arm und Kopf liegt ein Stück Wand, das von aussen nicht
  //     erreichbar ist — es blieb als grauer Fleck in der Schulter stehen.
  //     Unterschieden wird nach Grösse: eine echte Lücke ist gross, ein
  //     Loch durch Bildrauschen ist klein und soll weiterhin zugehen.
  const MIN_LUECKE = 300; // Pixel
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
      for (const j of nb) {
        if (!gesehen[j] && !hg[j] && alpha[j] < SPERRE) { gesehen[j] = 1; st.push(j); }
      }
    }
    if (gruppe.length >= MIN_LUECKE) for (const i of gruppe) hg[i] = 1;
  }

  // 3) Alpha setzen + Grau-Saum herausrechnen.
  //    Halbtransparente Randpixel tragen noch die Wandfarbe:
  //      C_fg = (C_beobachtet - (1-a) * C_bg) / a
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = hg[i] ? alpha[i] : 1;
    d[p+3] = Math.round(a * 255);
    if (a >= DESPILL_AB && a < 1) {
      d[p]   = klemm((d[p]   - (1-a) * br)  / a);
      d[p+1] = klemm((d[p+1] - (1-a) * bg_) / a);
      d[p+2] = klemm((d[p+2] - (1-a) * bb)  / a);
    }
  }
  return img;
}

const klemm = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// Name aus der ursprünglichen Fassung beibehalten, damit unten nichts
// umbenannt werden muss — gekeyt wird jetzt gegen die gemessene Wandfarbe.
const keyWhite = keyFlatBg;

function alphaBox(img) {
  const d = img.data;
  let minX = img.width, maxX = -1, minY = img.height, maxY = -1;
  for (let i = 0; i < img.width * img.height; i++) {
    if (d[i*4+3] > 24) {
      const x = i % img.width, y = (i / img.width) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { left: minX, top: minY, w: maxX-minX+1, h: maxY-minY+1 };
}

/**
 * Abstand zweier Frames für die Loop-Suche.
 *
 * WICHTIG: NICHT auf die Silhouette normieren. Der Affe klettert auf der
 * Stelle, die Figur bleibt also ungefähr im Bild — die eigentliche Bewegung
 * (Beine, Schwanz, Körperschwerpunkt) steckt genau in der Verschiebung.
 * Ein erster Versuch mit Bounding-Box-Normierung rechnete sie heraus und
 * lieferte für ALLE Stichproben denselben Abstand 0.0.
 *
 * Verglichen wird deshalb roh: beide Bilder auf 96x96 herunterskaliert,
 * mittlerer Kanalabstand inklusive Alpha.
 */
const RAST = 96;
const rasterCache = new WeakMap();

function raster(img) {
  if (rasterCache.has(img)) return rasterCache.get(img);
  const tmp = document.createElement('canvas');
  tmp.width = img.width; tmp.height = img.height;
  tmp.getContext('2d').putImageData(img, 0, 0);

  const c = document.createElement('canvas');
  c.width = RAST; c.height = RAST;
  const k = c.getContext('2d', { willReadFrequently: true });
  k.drawImage(tmp, 0, 0, img.width, img.height, 0, 0, RAST, RAST);
  const d = k.getImageData(0, 0, RAST, RAST).data;
  rasterCache.set(img, d);
  return d;
}

function distanz(a, b) {
  const da = raster(a), db = raster(b);
  let s = 0;
  for (let i = 0; i < da.length; i += 4) {
    s += Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) +
         Math.abs(da[i+2]-db[i+2]) + Math.abs(da[i+3]-db[i+3]);
  }
  return s / (RAST*RAST*4);
}

/* ------------------------------------------------ Selbstkontrolle ------ *
 * Erst prüfen, ob das Springen überhaupt ein anderes Bild liefert. Ohne
 * diese Kontrolle liefen schon drei Durchgänge scheinbar erfolgreich durch
 * und schrieben zwölfmal dasselbe Bild.
 */
{
  const a = await grab(0.001);
  const b = await grab(DUR * 0.5);
  const d = distanz(a, b);
  log(\`Selbstkontrolle: Abstand Bild@0s zu Bild@\${(DUR*0.5).toFixed(2)}s = \${d.toFixed(2)}\`,
      d < 0.5 ? 'warn' : 'ok');
  if (d < 0.5) {
    log('ABBRUCH: Das Springen liefert immer dasselbe Bild. Seite in einem ' +
        'SICHTBAREN Browserfenster öffnen (nicht in einem Hintergrundtab).', 'warn');
    throw new Error('Video-Seeking liefert identische Bilder');
  }
}

/* =========================================================== PROBE ===== */
if (MODUS === 'probe') {
  // Eckfarben verraten, ob der Hintergrund weiss ist.
  const f0 = await grab(0.001);
  const eck = (x, y) => {
    const i = (y * W + x) * 4;
    return \`rgb(\${f0.data[i]},\${f0.data[i+1]},\${f0.data[i+2]})\`;
  };
  log(\`Ecken: oben-links \${eck(2,2)}  oben-rechts \${eck(W-3,2)}  \` +
      \`unten-links \${eck(2,H-3)}  unten-rechts \${eck(W-3,H-3)}\`);

  for (let i = 0; i < ANZAHL; i++) {
    const t = (DUR * i) / ANZAHL;
    const img = await grab(t);
    ctx.putImageData(img, 0, 0);
    const blob = await toBlob(cv);
    await postPNG(\`probe_\${String(i).padStart(2,'0')}.png\`, blob);
    log(\`  Stichprobe \${i} @ \${t.toFixed(3)}s\`);
  }
  log('PROBE FERTIG', 'ok');
  await fetch('/done', { method:'POST', body: JSON.stringify({ W, H, DUR }) });
}

/* ========================================================= EXTRACT ===== */
if (MODUS === 'extract') {
  // 1) Loop-Länge suchen: Stichproben über die volle Länge, Abstand zu Frame 0,
  //    erstes klares Minimum.
  // Für die Loop-Suche wird BEWUSST nicht freigestellt: gemessen wird nur,
  // ob sich das Bild bewegt, und dafür taugt das Rohbild genauso. Das
  // Freistellen ist der teure Teil (Flutung plus Lückenanalyse über knapp
  // eine Million Pixel) — 40-mal dafür zu warten kostet Minuten für nichts.
  const N = 40;
  const ref = await grab(0.001);
  const dists = [];
  for (let i = 1; i < N; i++) {
    const t = (DUR * i) / N;
    const d = distanz(ref, await grab(t));
    dists.push({ i, t, d });
  }
  const nachbar = dists.reduce((s, x) => s + x.d, 0) / dists.length;
  log('Abstand zu Frame 0: ' + dists.map(x => \`\${x.i}:\${x.d.toFixed(1)}\`).join('  '));

  // Ein Kletterzyklus ist nie kürzer als eine knappe halbe Sekunde. Ohne
  // diese Sperre schnappt die Suche auf das triviale Minimum direkt neben
  // Frame 0 (dort ist das Bild naturgemäss fast identisch) und tastet dann
  // nur ein Zehntel des Videos ab.
  const MIN_PERIODE = 0.45;
  const brauchbar = dists.filter((x) => x.t >= MIN_PERIODE);

  let periode = null;
  for (let k = 1; k < brauchbar.length - 1; k++) {
    const p = brauchbar[k];
    if (p.d < brauchbar[k-1].d && p.d <= brauchbar[k+1].d && p.d < nachbar * 0.75) {
      periode = p.t;
      break;
    }
  }
  if (periode === null && brauchbar.length) {
    // Kein klares Minimum: das globale Minimum jenseits der Sperre nehmen.
    let best = brauchbar[0];
    for (const x of brauchbar) if (x.d < best.d) best = x;
    periode = best.d < nachbar * 0.9 ? best.t : DUR;
    log(\`kein klares Minimum — Rückfall auf \${periode === DUR ? 'volle Länge' : 'globales Minimum'}\`, 'warn');
  }
  if (!periode) periode = DUR;

  const spanne = Math.max(...dists.map((x) => x.d));
  log(\`Schnitt \${nachbar.toFixed(1)}, Maximum \${spanne.toFixed(1)} — Loop-Länge \${periode.toFixed(3)} s\`,
      spanne < 1 ? 'warn' : 'ok');
  if (spanne < 1) log('WARNUNG: kaum Unterschied zwischen den Stichproben — springt das Video überhaupt?', 'warn');

  /* 2) Zyklus abtasten — aber nur WIRKLICH VERSCHIEDENE Bilder behalten.
   *
   * Die Videos haben eine niedrigere Bildrate als die gewünschte Abtastung.
   * Wer stur ANZAHL-mal gleichmässig abtastet, trifft mehrfach dasselbe
   * Quellbild: im weissen Satz lagen drei Nachbarpaare bei einem Abstand von
   * 0.6–1.0, während der bewährte braune Satz nie unter 33 liegt. Im Spiel
   * hakt die Animation dann sichtbar dreimal pro Zyklus.
   *
   * Deshalb dicht abtasten (4-fach), gleiche Bilder verwerfen und aus dem
   * Rest gleichmässig bis zu ANZAHL Stück auswählen. Lieber weniger Bilder
   * als doppelte — die Bildzahl steht pro Charakter in CONFIG.
   */
  /* Schwellwert auf der RICHTIGEN Skala.
   *
   * Verglichen wird das ganze Rohbild, und darin ist rund 80 % der Fläche
   * unbewegte graue Wand — die Abstände liegen dadurch nur zwischen 0 und
   * etwa 10, während dieselben Bilder zugeschnitten auf die Figur 0 bis 55
   * ergeben. Ein erster Versuch mit 5 (der Zuschnitt-Skala entlehnt) verwarf
   * fast alles und liess nur 5 Bilder übrig.
   *
   * Zwei Abtastungen desselben Quellbildes liefern EXAKT 0. "Neues Bild"
   * allein genügt aber nicht als Kriterium: die Videos enthalten selbst
   * Bildpaare, die zwar verschieden dekodieren, aber praktisch gleich
   * aussehen (gemessen 0.10 / 0.11 / 0.12 / 0.81 gegenüber 3.6–5.5 bei einem
   * echten Bewegungsschritt). Mit einer Grenze knapp über null blieben sie
   * drin, und die Animation hakte weiter.
   *
   * Verglichen wird gegen das zuletzt BEHALTENE Bild, nicht gegen die
   * vorherige Stichprobe — kleine Schritte summieren sich damit auf, statt
   * einzeln durchzufallen. Eine langsame Bewegung geht so nicht verloren.
   */
  const MIN_ABSTAND = 2.5;
  const DICHTE = 4;
  const kandidaten = [];
  const abstaende = [];
  let vorheriges = null;

  for (let i = 0; i < ANZAHL * DICHTE; i++) {
    const t = (periode * i) / (ANZAHL * DICHTE) + 0.001;
    const roh = await grab(t);
    if (vorheriges) {
      const d = distanz(vorheriges, roh);
      abstaende.push(d);
      if (d < MIN_ABSTAND) continue; // dasselbe Quellbild
    }
    vorheriges = roh;
    kandidaten.push(t);
  }

  log(\`Abstände der dichten Abtastung: \${abstaende.map((x) => x.toFixed(2)).join(' ')}\`);

  // Gleichmässig bis zu ANZAHL Zeitpunkte aus den brauchbaren auswählen.
  const gewaehlt = [];
  const schritt = kandidaten.length / Math.min(ANZAHL, kandidaten.length);
  for (let i = 0; i < Math.min(ANZAHL, kandidaten.length); i++) {
    gewaehlt.push(kandidaten[Math.floor(i * schritt)]);
  }

  log(\`\${kandidaten.length} verschiedene Bilder im Zyklus, davon \${gewaehlt.length} geschrieben\`,
      gewaehlt.length < ANZAHL ? 'warn' : 'ok');

  const boxen = [];
  for (let i = 0; i < gewaehlt.length; i++) {
    const t = gewaehlt[i];
    const img = keyWhite(await grab(t));
    const box = alphaBox(img);
    boxen.push(box);

    const c = document.createElement('canvas');
    c.width = box.w; c.height = box.h;
    const k = c.getContext('2d');
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d').putImageData(img, 0, 0);
    k.drawImage(tmp, box.left, box.top, box.w, box.h, 0, 0, box.w, box.h);

    const blob = await toBlob(c);
    await postPNG(\`move_\${String(i).padStart(2,'0')}.png\`, blob);
    log(\`  Frame \${i} @ \${t.toFixed(3)}s  \${box.w}x\${box.h}\`);
  }

  // 3) Kontrolle: schliesst der Loop, und wie eng liegen die Nachbarn?
  //    Der bewaehrte braune Satz liegt nie unter 33 — alles darunter haekelt.
  const erst = await grab(gewaehlt[0]);
  const letzt = await grab(gewaehlt[gewaehlt.length - 1]);
  log(\`Loop-Kontrolle: Abstand letzter->erster = \${distanz(letzt, erst).toFixed(1)}\`, 'ok');
  log(\`GESCHRIEBEN: \${gewaehlt.length} Bilder — CONFIG.characters muss frames mit \` +
      \`\${gewaehlt.length} Einträgen bekommen\`, 'ok');
  log('EXTRACT FERTIG', 'ok');
  await fetch('/done', { method:'POST', body: JSON.stringify({ W, H, DUR, periode, anzahl: gewaehlt.length }) });
}
</script>`;

/* ----------------------------------------------------------------- Server */

let geschrieben = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    console.log('  Seite abgerufen — Extraktion läuft im Browser an');
    // no-store ist Pflicht: der Browser lieferte sonst eine zwischengespeicherte
    // Fassung der Seite aus, und Änderungen am Skript wirkten schlicht nicht.
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
    });
    res.end(SEITE);
    return;
  }

  // Lebenszeichen aus der Seite, damit man von aussen sieht, wo sie steht.
  if (url.pathname === '/log' && req.method === 'POST') {
    const teile = [];
    req.on('data', (c) => teile.push(c));
    req.on('end', () => {
      console.log('  [Seite] ' + Buffer.concat(teile).toString());
      res.writeHead(204).end();
    });
    return;
  }

  if (url.pathname === '/video') {
    // Bereichsanfragen beantworten. Ohne 206/Accept-Ranges verweigert der
    // Browser das Springen im Video — er kann dann nur linear abspielen.
    const { size } = statSync(VIDEO);
    const bereich = req.headers.range;

    if (bereich) {
      const treffer = /bytes=(\d*)-(\d*)/.exec(bereich);
      const von = treffer && treffer[1] ? Number(treffer[1]) : 0;
      const bis = treffer && treffer[2] ? Number(treffer[2]) : size - 1;
      res.writeHead(206, {
        'content-type': 'video/mp4',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${von}-${bis}/${size}`,
        'content-length': bis - von + 1,
      });
      createReadStream(VIDEO, { start: von, end: bis }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'content-length': size,
    });
    createReadStream(VIDEO).pipe(res);
    return;
  }

  if (url.pathname.startsWith('/frame/') && req.method === 'POST') {
    const name = url.pathname.slice('/frame/'.length).replace(/[^\w.\-]/g, '');
    const teile = [];
    req.on('data', (c) => teile.push(c));
    req.on('end', () => {
      writeFileSync(resolve(ZIEL, name), Buffer.concat(teile));
      geschrieben++;
      console.log(`  geschrieben: ${name}`);
      res.writeHead(204).end();
    });
    return;
  }

  if (url.pathname === '/done' && req.method === 'POST') {
    const teile = [];
    req.on('data', (c) => teile.push(c));
    req.on('end', () => {
      res.writeHead(204).end();
      const info = JSON.parse(Buffer.concat(teile).toString() || '{}');
      console.log(`\nFERTIG — ${geschrieben} Bilder in ${ZIEL}`);
      console.log(`Video: ${info.W}x${info.H}, ${Number(info.DUR).toFixed(3)} s` +
        (info.periode ? `, Loop ${Number(info.periode).toFixed(3)} s` : ''));
      // Überzählige Bilder eines früheren, längeren Laufs wegräumen — sonst
      // lägen im Ordner Reste, die prepare-art.mjs mit einsammeln würde.
      if (info.anzahl) {
        for (const datei of readdirSync(ZIEL)) {
          const treffer = /^move_(\d+)\.png$/i.exec(datei);
          if (treffer && Number(treffer[1]) >= info.anzahl) {
            rmSync(resolve(ZIEL, datei), { force: true });
            console.log(`  entfernt (Rest eines frueheren Laufs): ${datei}`);
          }
        }
      }

      if (info.anzahl && info.anzahl !== ANZAHL) {
        console.log(
          `\nACHTUNG: nur ${info.anzahl} statt ${ANZAHL} Bilder — der Rest waren ` +
            `Wiederholungen desselben Quellbildes.\n` +
            `CONFIG.characters.list[...].frames muss ${info.anzahl} Einträge haben ` +
            `(0 bis ${info.anzahl - 1}).`,
        );
      }
      server.close();
      setTimeout(() => process.exit(0), 100);
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`Modus:  ${modus}`);
  console.log(`Video:  ${VIDEO}`);
  console.log(`Ziel:   ${ZIEL}`);
  console.log(`\nSeite:  http://localhost:${PORT}/   (im Browser öffnen)`);
});
