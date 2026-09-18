# ===========================================================================
#  Jungle Climber als Container — für Coolify oder jeden anderen Docker-Host
#
#  ZWEI STUFEN, UND DAS IST DER GANZE WITZ
#  Die erste Stufe baut mit Node; die zweite nimmt nur das fertige `dist/`
#  und wirft alles andere weg. Node, npm und node_modules (über 300 MB)
#  landen NICHT im ausgelieferten Bild. Übrig bleiben rund 40 MB Spiel auf
#  einem schlanken nginx.
#
#  WARUM ÜBERHAUPT EIN DOCKERFILE UND NICHT COOLIFYS "STATIC SITE"
#  Die statische Voreinstellung liefert Dateien aus, kennt aber unsere
#  Cache-Regeln nicht. Ohne sie lädt jedes Handy bei jedem Aufruf 37 MB neu,
#  davon 25 MB Musik. Die Regeln stehen in nginx.conf; ein Dockerfile ist der
#  einzige Weg, sie zuverlässig mitzugeben — und das Bild läuft damit
#  unverändert auch auf jedem anderen Host, falls Coolify eines Tages weg ist.
# ===========================================================================

# --------------------------------------------------------------- 1. Bauen
FROM node:22-alpine AS bauen

WORKDIR /bau

# Erst NUR die Abhängigkeitslisten kopieren, dann installieren.
#
# Docker legt je Zeile eine zwischengespeicherte Schicht an. Käme hier
# `COPY . .`, würde jede noch so kleine Änderung am Spielcode das komplette
# `npm ci` erneut auslösen — mehrere Minuten pro Veröffentlichung. So läuft
# es nur neu, wenn sich die Abhängigkeiten wirklich ändern.
COPY package.json package-lock.json ./

# `npm ci` statt `npm install`: baut streng nach package-lock.json und
# schlägt fehl, wenn beide auseinanderlaufen. Genau das will man beim
# Veröffentlichen — eine stillschweigend andere Fassung einer Bibliothek
# wäre ein Fehler, den niemand bemerkt.
RUN npm ci

COPY . .
RUN npm run build

# ----------------------------------------------------------- 2. Ausliefern
FROM nginx:1.27-alpine

# Die mitgelieferte Beispielseite weg, sonst liegt sie unter dem Spiel.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/jungle-climber.conf
COPY --from=bauen /bau/dist /usr/share/nginx/html

# 8080 statt 80: Der Container läuft damit auch ohne Root-Rechte. Ports
# unter 1024 darf nur Root öffnen, und ein Webserver, der als Root läuft,
# ist ein unnötiges Risiko.
EXPOSE 8080

# Coolify erkennt daran, ob der Container wirklich bereit ist, statt nur zu
# prüfen, ob der Prozess lebt.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/gesund || exit 1

CMD ["nginx", "-g", "daemon off;"]
