# Auf Vercel ausliefern

Damit man das Spiel am Handy aufrufen kann, ohne etwas zu installieren.

## Warum Vercel und nicht GitHub Pages

Vercel liefert **das Spiel** aus, GitHub Pages **nur die Datenschutzseite**.
Beide laufen nebeneinander, sie stören sich nicht.

Als das hier entstand, war das Repo privat — und GitHub Pages verlangt für
private Repos einen Bezahlplan (GitHub Pro). Vercel war für private Repos
gratis, und die GitHub-App war ohnehin schon installiert.

> **Das gilt nicht mehr:** das Repo ist inzwischen öffentlich, damit ist Pages
> kostenlos. Genau darauf liegt jetzt die Datenschutzseite aus `docs/`, die
> Google Play als öffentliche Adresse verlangt:
> `https://marcovaccari20.github.io/jump-and-run-monkey/`
>
> Einzuschalten unter *Settings → Pages → Source: Branch `main`, Ordner
> `/docs`*. Das lässt sich nur dort klicken, nicht aus dem Projekt heraus.
> Für das Spiel selbst bleibt Vercel zuständig — Pages liefert `docs/`, und
> der Ordner enthält kein Spiel.

Ein Unterschied, der hier zufällig zum Nachteil wird: Vercel liefert im
Wurzelverzeichnis aus, die Spieleportale im Unterordner. Der Unterordner-Fall
wird über Vercel also **nicht** mitgetestet — dafür gibt es
`npm run pruef:unterordner`, das ihn lokal nachstellt. Nach jeder Änderung an
Asset-Pfaden einmal laufen lassen.

## Einmalig einrichten

1. https://vercel.com/new öffnen
2. Repository `jump-and-run-monkey` auswählen (ggf. Zugriff erlauben)
3. Vercel erkennt Vite von selbst. Nichts umstellen — `vercel.json` im
   Projektwurzelverzeichnis gibt Bauweise und Kopfzeilen vor.
4. **Deploy**

Danach baut Vercel bei jedem Push auf `main` automatisch neu.

## Was in vercel.json steht und warum

Das Spiel wiegt rund 41 MB, davon 36 MB Musik. Ohne passende Kopfzeilen lädt
ein Telefon das bei jedem Aufruf neu — beim Testen mehrmals täglich.

| Was | Wie lange gecacht | Grund |
|---|---|---|
| `/assets/*` | 1 Jahr, unveränderlich | Vite hängt einen Hash an den Dateinamen. Ändert sich der Inhalt, ändert sich der Name — die Datei kann also nie veralten. |
| `/musik/`, `/klang/`, `/textures/`, `/hazards/`, `/characters/` | 1 Tag frisch, danach 1 Woche im Hintergrund erneuern | Diese Namen sind FEST (sie kommen aus `public/`). Ein Jahr wäre falsch: wer die Musik neu erzeugt, bekäme tagelang die alte. Ein Tag ist kurz genug, um Änderungen zu sehen, und lang genug, um beim Testen nicht dauernd 36 MB zu ziehen. |
| `*.html` | gar nicht | Die Einstiegsdatei verweist auf die gehashten Namen. Wird sie gecacht, sieht man nach einem Push weiter die alte Fassung — der klassische „warum ändert sich nichts"-Fehler. |

## Wenn am Handy nichts zu hören ist

**Zuerst den Klingelschalter an der Seite des iPhones prüfen.** Er schaltet
Web-Audio stumm, und zwar ohne dass die Seite es merkt: der Ton-Knopf im
Spiel zeigt weiter an. Das betrifft jedes Browserspiel mit Web Audio und
lässt sich im Code nicht abfangen.
