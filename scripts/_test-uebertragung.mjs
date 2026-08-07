/** Prüft die Übertragung per vierstelligem Code gegen die echte Datenbank. */
import { CONFIG } from '../src/config.js';

const { url, schluessel } = CONFIG.bestenliste;
const kopf = {
  apikey: schluessel,
  Authorization: `Bearer ${schluessel}`,
  'Content-Type': 'application/json',
};

const ruf = async (fn, body) => {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: kopf,
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    /* kein JSON */
  }
  return { s: r.status, t, j };
};

let fehler = 0;
const P = (n, b, d) => {
  if (!b) fehler++;
  console.log('  ' + (b ? 'OK     ' : 'FEHLER ') + n.padEnd(32) + d);
};

console.log('=== Gerät A: Fortschritt anlegen, Code holen ===');
const a = crypto.randomUUID();
let r = await ruf('stand_sichern', {
  p_spieler: a,
  p_muenzen: 512,
  p_frei: ['braun', 'standard', 'weiss', 'pink'],
});
P('Stand gespeichert', r.s < 300, 'HTTP ' + r.s);

r = await ruf('code_vorschlag', { p_spieler: a });
const code = String(r.j ?? '');
P('freien Code geholt', r.s === 200 && /^[0-9]{4}$/.test(code), `HTTP ${r.s}  Code: ${code}`);

console.log('\n=== Gerät B: Code eingeben, Stand holen ===');
r = await ruf('code_aufloesen', { p_code: code });
P('Code aufgelöst', r.s === 200 && r.j?.ok === true, `HTTP ${r.s}  ${JSON.stringify(r.j).slice(0, 70)}`);
const kennung = r.j?.kennung;

r = await ruf('stand_laden', { p_spieler: kennung });
P(
  'Stand auf Gerät B',
  r.s === 200 && r.j?.muenzen === 512 && r.j?.frei?.length === 4,
  JSON.stringify(r.j),
);

console.log('\n=== Missbrauch ===');
r = await ruf('code_aufloesen', { p_code: '0000' });
P('unbekannter Code', r.s >= 400 || r.j?.ok === false, `HTTP ${r.s}  ${JSON.stringify(r.j ?? r.t).slice(0, 55)}`);

r = await ruf('code_belegen', { p_code: code, p_spieler: crypto.randomUUID() });
P(
  'fremden Code kapern',
  r.s >= 400 || !r.j || String(r.j) !== code,
  `HTTP ${r.s}  ${JSON.stringify(r.j ?? r.t).slice(0, 55)}`,
);

console.log('\n' + (fehler === 0 ? '>>> ÜBERTRAGUNG FUNKTIONIERT <<<' : `>>> ${fehler} FEHLER <<<`));
process.exit(fehler === 0 ? 0 : 1);
