# Konten, Mailversand und Kapazität

Alles zur Anmeldung mit E-Mail und Passwort: was noch einzustellen ist, wie
viele Nutzer der Gratistarif trägt, und warum ein eigener Mailversand nicht
optional ist.

---

## 1. Was JETZT noch fehlt (sonst kann sich niemand registrieren)

Zwei Schalter im Supabase-Dashboard. Ohne sie ist die Registrierung
**blockiert** — gemessen, nicht vermutet:

```
POST /auth/v1/signup
-> {"code":429,"error_code":"over_email_send_rate_limit",
    "msg":"email rate limit exceeded"}
```

Dass überhaupt eine Mail verschickt werden sollte, beweist zugleich: die
Bestätigung per E-Mail ist eingeschaltet.

### a) Bestätigungsmail abschalten — Empfehlung

**Authentication → Sign In / Providers → Email → „Confirm email" AUS**

Dann ist der Spieler sofort nach dem Registrieren angemeldet, ohne Umweg über
sein Postfach. Der Mailversand liegt damit nicht mehr auf dem kritischen Weg.

*Der Preis:* jemand kann sich mit einer fremden Adresse anmelden, und der
Besitzer dieser Adresse könnte das Konto später per „Passwort vergessen"
übernehmen. Bei einem Spiel, in dem es nur Münzen und Fellfarben zu holen
gibt, ist das hinnehmbar. Bei allem, wo Geld oder echte Daten hängen, wäre es
das nicht.

### b) Eigenen Mailversand einrichten — Pflicht für „Passwort vergessen"

Der eingebaute Versand von Supabase ist ausdrücklich nicht für den Betrieb
gedacht und blockt, wie oben gemessen, schon beim ersten Anlauf. Für das
Zurücksetzen von Passwörtern führt kein Weg an eigenem SMTP vorbei.

---

## 2. Resend einrichten

Resend ist die einfachste Wahl und im Gratistarif ausreichend
(Stand August 2026: **3 000 Mails im Monat, 100 pro Tag** — vor der
Einrichtung kurz auf resend.com/pricing gegenprüfen, solche Zahlen ändern
sich).

### Schritt 1 — Konto und Domain

1. Konto auf [resend.com](https://resend.com) anlegen.
2. **Domains → Add Domain**. Nimm eine Subdomain, nicht die nackte:
   `mail.mycallmanager.ch`. So bleibt der Mailversand des Spiels vom
   Geschäftsmailverkehr getrennt; ein Zustellproblem des einen zieht das
   andere nicht mit hinunter.
3. Resend zeigt drei DNS-Einträge (`TXT` für SPF, `TXT` für DKIM, meist ein
   `MX`). Die trägst du bei deinem Domain-Anbieter ein.
4. Warten, bis Resend „Verified" zeigt. Dauert Minuten bis Stunden.

### Schritt 2 — API-Schlüssel

**API Keys → Create API Key**, Rechte „Sending access". Der Schlüssel
(`re_…`) wird **einmal** angezeigt. In den Passwortmanager, nicht in eine
Datei im Projekt.

### Schritt 3 — In Supabase eintragen

**Authentication → Emails → SMTP Settings → Enable Custom SMTP**

| Feld | Wert |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (wörtlich, kein Name von dir) |
| Password | dein `re_…`-Schlüssel |
| Sender email | `noreply@mail.mycallmanager.ch` |
| Sender name | `Jungle Climber` |

### Schritt 4 — Rücksprung-Adresse freigeben

**Authentication → URL Configuration → Redirect URLs**

Dort muss die Adresse stehen, unter der das Spiel im Web läuft. Der Link aus
der Mail landet sonst stillschweigend auf der Site-URL.

Falls du eine andere Zieladresse willst als die Site-URL, trag sie in
`src/config.js` unter `bestenliste.passwortZielUrl` ein — sie muss hier
freigegeben sein, sonst wird sie ignoriert.

> **Für die Play-Store-App:** der Link öffnet den Browser, nicht die App. Der
> Spieler setzt das Passwort dort und meldet sich danach in der App an. Das
> ist Absicht — ein Deep Link in die App wäre erheblich mehr Aufwand für
> denselben Zweck.

### Schritt 5 — Nach dem Einrichten prüfen

Registriere dich einmal selbst mit einer echten Adresse und klick „Forgot your
password?". Kommt keine Mail: **Resend → Logs** zeigt, ob sie überhaupt
losgeschickt wurde.

> **Achtung beim Start:** mit eigenem SMTP begrenzt Supabase auf **30 neue
> Nutzer pro Stunde**. Einstellbar unter **Authentication → Rate Limits**.
> Wer das nicht hochsetzt, sieht bei einem gelungenen Start Registrierungen
> scheitern.

---

## 3. Wie viele Nutzer trägt der Gratistarif?

Gemessen an der eigenen Datenbank am 19. August 2026:

| Wert | Messung |
|---|---|
| Datenbank gesamt | 11 MB |
| davon `public` (Spiel) | 456 kB bei 172 Spielern |
| davon `auth` bei **0** Nutzern | 1 088 kB — reine Grundlast |
| eine Spielerzeile, netto | 110 Bytes |

**Speicher ist nicht die Grenze.** Rechnet man grosszügig mit 2 kB je
registriertem Nutzer (Spielzeile, `auth.users`, Identität, Sitzungen,
Indexeinträge), passen in die verbleibenden ~489 MB rund **250 000 Konten**.
Selbst mit dem sehr pessimistischen Ansatz von 5 kB wären es noch 100 000.

Was **vorher** greift, in dieser Reihenfolge:

| Grenze (Gratistarif) | Wert | Bedeutung fürs Spiel |
|---|---|---|
| **Monatlich aktive Nutzer** | **50 000 MAU** | **Die eigentliche Grenze.** Zählt jeden angemeldeten Spieler, der im Monat aktiv war. |
| Datenbankgrösse | 500 MB | ~250 000 Konten — weit dahinter. |
| Egress | 5 GB/Monat | Ein Speichern kostet ~1 kB. Reicht für Millionen Aufrufe. Die Spieldateien selbst liegen nicht hier. |
| Mails | 3 000/Monat (Resend) | Nur Passwort-Rücksetzungen. Bei 50 000 Spielern vergessen erfahrungsgemäss weit weniger als 3 000 im Monat ihr Passwort — aber im Auge behalten. |

**Kurz: 50 000 monatlich aktive angemeldete Spieler.** Wer nicht angemeldet
spielt, zählt gar nicht mit — nur wer ein Konto hat und es benutzt.

### Die Falle, die vorher zuschlägt

> Supabase **pausiert Projekte im Gratistarif nach 7 Tagen ohne Aktivität.**
>
> Bei einer veröffentlichten App heisst das: Anmeldung kaputt, Bestenliste
> kaputt, Fortschritt wird nicht mehr gesichert. Das Spiel selbst läuft
> weiter (der lokale Speicher fängt es ab), aber jeder Serverdienst schweigt.
>
> Solange die App läuft, kommt täglich Verkehr und das Problem stellt sich
> nicht. Gefährlich ist die Zeit **davor** — zwischen Fertigstellung und
> Veröffentlichung. Ein pausiertes Projekt lässt sich im Dashboard mit einem
> Klick wieder starten; man muss nur daran denken.
>
> Der Pro-Tarif (25 $/Monat) schliesst das aus. Solange die Spielerzahlen
> klein sind, ist der Gratistarif richtig — aber am Tag der
> Play-Store-Veröffentlichung gehört das kurz geprüft.

---

## 4. Was im Spiel bereits fertig ist

- Registrieren, Anmelden, Abmelden, Passwort vergessen, Passwort neu setzen
- Der Fortschritt folgt dem Konto auf jedes Gerät
- Beim Anmelden wird der bisherige Stand dieses Geräts **zusammengeführt**,
  nicht ersetzt: mehr Münzen gewinnt, Freigeschaltetes bleibt frei. Anmelden
  kann also nur gewinnen, nie verlieren.
- Ohne Konto läuft alles wie bisher weiter — die Anmeldung ist ein leiser
  Link im Menü, kein Tor vor dem Spiel.
- Der Datenschutztext im Spiel nennt jetzt Konten und E-Mail-Adressen. Er
  behauptete vorher das Gegenteil; das wäre im Play Store ein Problem für
  sich gewesen.

Geprüft mit `npm run pruef:konto` — 30 Fälle, darunter die drei, bei denen
ein Fehler wirklich Daten kostet: doppelte Sitzungserneuerung, Reihenfolge
beim Zusammenführen, und eine tote Sitzung, die nicht abgeräumt wird.
