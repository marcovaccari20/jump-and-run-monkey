# Umzug von Vercel zu Coolify

Stand 18. September 2026. Schritt für Schritt, in dieser Reihenfolge.

---

## Was sich NICHT ändert

**Supabase bleibt unangetastet.** Das Spiel spricht vom Browser aus direkt
mit Supabase — der Webhoster steht gar nicht dazwischen. Es gibt keinen
Servercode, keine Umgebungsvariablen, keine Datenbankverbindung im
Hintergrund. Nur statische Dateien.

**Die Android-App auch nicht.** Sie trägt alle Dateien in sich und lädt
nichts vom Webhoster. Play-Store-Fassung und Web-Fassung sind unabhängig
voneinander.

---

## Schritt 1 — Container-Dateien *(erledigt)*

Drei neue Dateien liegen im Projekt:

| Datei | Wozu |
|---|---|
| `Dockerfile` | Zweistufig: Stufe 1 baut mit Node, Stufe 2 nimmt nur das fertige `dist/` und wirft Node samt 300 MB `node_modules` weg. Übrig bleiben rund 40 MB auf nginx. |
| `nginx.conf` | Ersetzt `vercel.json`. Dieselben Cache-Regeln, Zeile für Zeile. |
| `.dockerignore` | Hält Rohmaterial, Skripte und die Android-Hülle aus dem Bau. |

**Warum nicht Coolifys „Static Site"-Voreinstellung?** Die liefert Dateien
aus, kennt aber unsere Cache-Regeln nicht. Ohne sie lädt jedes Handy bei
jedem Aufruf **37 MB neu, davon 25 MB Musik**. Mit Dockerfile läuft das Bild
ausserdem unverändert auf jedem anderen Host — falls Coolify je wegfällt.

Geprüft: Das Spiel baut nachweislich auch ohne die ausgeschlossenen Ordner
(`assets-src`, `pakete`, `scripts`, `docs`, `android` beiseitegeschoben,
Bau lief durch).

---

## Schritt 2 — In Coolify anlegen

1. **New Resource → Application → Public Repository**
2. Repository: `https://github.com/marcovaccari20/jump-and-run-monkey`
3. Branch: `main`
4. **Build Pack: `Dockerfile`** ← wichtig, nicht „Nixpacks" und nicht „Static"
5. **Ports Exposes: `8080`**
6. Deploy

Coolify findet `Dockerfile` und `nginx.conf` von selbst; es ist nichts
einzutragen ausser dem Port.

> **Der erste Bau dauert mehrere Minuten** — `npm ci` lädt alle
> Abhängigkeiten. Jeder weitere ist schnell, weil Docker die Schicht
> zwischenspeichert, solange sich `package-lock.json` nicht ändert.

---

## Schritt 3 — Prüfen, bevor die Domain umgestellt wird

Coolify gibt dir zuerst eine eigene Adresse. Auf der prüfen:

1. **Spiel startet** und lässt sich spielen
2. **Bestenliste lädt** — beweist, dass Supabase erreichbar ist
3. **Cache-Regeln greifen.** Im Browser F12 → Netzwerk → eine Datei aus
   `/assets/` anklicken → unter „Response Headers" muss stehen:
   ```
   cache-control: public, max-age=31536000, immutable
   ```
   Fehlt die Zeile, greift `nginx.conf` nicht — dann ist vermutlich doch
   „Static" statt „Dockerfile" als Build Pack eingestellt.
4. **Lebenszeichen:** `deine-adresse/gesund` muss `ok` zeigen.

---

## Schritt 4 — Eigene Domain

In Coolify unter **Domains** eintragen. Coolify holt das Zertifikat
selbst über Let's Encrypt.

---

## Schritt 5 — Supabase nachziehen *(der einzige Punkt, der Supabase betrifft)*

**Authentication → URL Configuration → Redirect URLs**: neue Adresse
eintragen.

Nötig für den „Passwort vergessen"-Link — der landet sonst weiter auf der
alten Adresse. Betrifft nur angemeldete Spieler; solange es keine Konten
gibt, ist es unkritisch, aber es gehört gemacht, bevor es jemand merkt.

---

## Schritt 6 — Vercel abschalten

**Erst wenn Schritt 3 vollständig grün war.** In Vercel das Projekt löschen
oder die Domain abhängen.

`vercel.json` kann im Repository bleiben — sie stört Coolify nicht und ist
der Rückweg, falls du es dir anders überlegst.

---

## Wenn etwas klemmt

| Symptom | Ursache |
|---|---|
| Bau bricht bei `npm ci` ab | `package-lock.json` passt nicht zu `package.json`. Lokal `npm install` laufen lassen, beide Dateien committen. |
| Seite lädt, aber Spiel bleibt schwarz | Browserkonsole (F12) ansehen. Meist eine fehlende Datei — prüfen, ob `dist/` im Bild wirklich vollständig ist. |
| Keine Cache-Header | Build Pack steht auf „Static" statt „Dockerfile". |
| Container startet nicht | Coolify-Logs ansehen: Ein Tippfehler in `nginx.conf` lässt nginx sofort mit einer klaren Zeilenangabe abbrechen. |

> **Offen geblieben:** Auf diesem Rechner ist kein Docker installiert, der
> Container-Bau konnte hier also nicht ausprobiert werden. Geprüft wurde,
> was ohne Docker prüfbar war: dass das Spiel ohne die ausgeschlossenen
> Ordner baut, dass `package-lock.json` vorhanden ist und dass `npm run
> build` keine Hooks auslöst. Ein Syntaxfehler in `nginx.conf` würde sich
> beim ersten Coolify-Bau sofort zeigen.
