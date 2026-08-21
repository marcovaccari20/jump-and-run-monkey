# Die Android-Hülle (Play Store)

Dieselbe Spiel-Datei, die im Browser läuft, steckt hier in einer echten
Android-App. Gebaut mit [Capacitor](https://capacitorjs.com): das Spiel läuft
darin in einer System-WebView, die App drumherum liefert das, was eine
Webseite nicht kann — hier vor allem **AdMob**.

Das Web-SDK von CrazyGames oder GameMonetize würde in einer App gar nicht
laden, und der Play Store würde es auch nicht dulden. Deshalb gibt es für die
App einen eigenen Werbe-Adapter (`AdMobPortal` in `src/systems/Portal.js`).

---

## Was schon steht

| | |
|---|---|
| Paketname | `com.jungleclimber.app` |
| App-Name | Jungle Climber |
| Ordner | `android/` (versioniert) |
| Werbung | AdMob, mit Googles **Test-IDs** |
| Symbol | aus dem freigestellten Kletter-Affen, `npm run app:icon` |
| Berechtigungen | nur `INTERNET` (für Supabase) |

Der Bau ist geprüft: `assembleDebug` läuft durch, die AdMob-App-ID steht
nachweislich im fertigen APK, beide Anzeigenblock-IDs im Web-Bündel darin.

---

## Bauen

Voraussetzungen: Android Studio (bringt SDK und JDK mit).

```bash
# 1. Web-Bündel für die App bauen
VITE_ZIEL=playstore npm run build

# 2. In das native Projekt kopieren
npx cap sync android

# 3. APK bauen
cd android && ./gradlew assembleDebug
```

Das Ergebnis liegt in `android/app/build/outputs/apk/debug/app-debug.apk`.

Oder bequemer: `npx cap open android` öffnet Android Studio.

### Zwei Windows-Fallen, beide schon getreten

**`local.properties` verträgt keine Backslashes.** Die Datei ist eine
Java-Properties-Datei, und dort ist `\` ein Escape-Zeichen. `sdk.dir` muss
mit Schrägstrichen geschrieben werden:

```properties
sdk.dir=C:/Users/DEINNAME/AppData/Local/Android/Sdk
```

Mit Backslashes bricht Gradle mit *„Die Syntax für den Dateinamen … ist
falsch"* ab — eine Meldung, die auf alles Mögliche hindeutet, nur nicht auf
die wahre Ursache. Die Datei ist absichtlich nicht versioniert (der Pfad ist
je Rechner anders) und wird beim ersten Öffnen in Android Studio neu erzeugt.

**Leerzeichen im JDK-Pfad.** Falls Gradle das JDK nicht findet, hilft der
kurze Windows-Pfadname:

```bash
export JAVA_HOME="C:/PROGRA~1/Android/ANDROI~1/jbr"
```

---

## AdMob scharf schalten

Aktuell laufen **Googles offizielle Testanzeigen**. Sie zeigen immer etwas an,
rechnen aber nichts ab. Zum Veröffentlichen:

**1. Konto und Blöcke anlegen** — [admob.google.com](https://admob.google.com)
→ *App hinzufügen* → *Android* → „noch nicht veröffentlicht" ist zulässig.
Zwei Anzeigenblöcke erstellen:

| Typ | wofür im Spiel |
|---|---|
| **Belohnt** | Weiterspielen nach dem Tod |
| **Interstitial** | Zwischenspot zwischen zwei Runden |

**2. Drei Werte ersetzen** — und hier werden zwei Dinge gern verwechselt:

| Was | Format | Wohin |
|---|---|---|
| **App-ID** | `ca-app-pub-…` **~** `…` (Tilde) | `android/app/src/main/AndroidManifest.xml` |
| **Belohnt** | `ca-app-pub-…` **/** `…` (Schrägstrich) | `CONFIG.ad.admob.belohnt` |
| **Interstitial** | `ca-app-pub-…` **/** `…` | `CONFIG.ad.admob.zwischen` |

**3.** `CONFIG.ad.admob.test` auf `false`.

> **Niemals selbst auf die eigenen Anzeigen tippen**, sobald `test: false`
> und die echten IDs drin sind. Google wertet das als Betrug und sperrt das
> Konto — dauerhaft. Zum Ausprobieren immer `test: true` lassen.

Fehlt die App-ID im Manifest, **stürzt die App beim Start ab**. Das ist
Absicht von Google, kein Fehler des Plugins.

---

## Veröffentlichen

### Signierschlüssel — der Teil, bei dem es keine zweite Chance gibt

Jede App wird signiert. Der Schlüssel entscheidet auf ewig, wer diese App
aktualisieren darf.

```bash
keytool -genkey -v -keystore jungle-climber.keystore \
  -alias jungleclimber -keyalg RSA -keysize 2048 -validity 10000
```

> **Diese Datei und ihr Passwort sofort sichern** — Passwort-Manager, zweite
> Kopie ausserhalb des Rechners. Verlierst du sie, kannst du diese App
> **nie wieder aktualisieren**. Kein Support, keine Ausnahme, kein
> Wiederherstellungsweg. Der einzige Ausweg wäre ein komplett neuer
> Store-Eintrag mit neuem Paketnamen, ohne Bewertungen und ohne Installationen.
>
> Die Keystore-Datei gehört **nicht** ins Repository.

Google Play verlangt ein **AAB**, kein APK:

```bash
cd android && ./gradlew bundleRelease
```

### Was die Play Console ausserdem will

- Datenschutzerklärung als **öffentliche URL**:
  `https://marcovaccari20.github.io/jump-and-run-monkey/`
  Quelle ist `docs/index.html`. Ausgeliefert über GitHub Pages —
  *Settings → Pages → Branch `main`, Ordner `/docs`*. Gratis, weil das Repo
  öffentlich ist. Der Text steht zusätzlich im Spiel unter „Privacy & data",
  das genügt Google aber nicht: die Adresse muss ohne Installation aufrufbar
  sein.
- Alterseinstufung (Fragebogen)
- Data-Safety-Formular — die fertigen Antworten stehen in `STORE-TEXTE.md`.

  > **Hier stand einmal „Name und Höhe für die Bestenliste, sonst nichts".**
  > Das war zur Zeit der Testanzeigen richtig und ist es seitdem nicht mehr:
  > mit der Konto-Anmeldung kam die **E-Mail-Adresse** dazu, und mit den
  > echten AdMob-Kennungen die **Werbe-ID** — letztere fügt das Plugin beim
  > Bauen selbst hinzu (`AD_ID`), man sieht sie nirgends im Quelltext. Wer
  > sie im Formular verschweigt, wird abgelehnt oder später gesperrt.

- Symbol 512×512, Funktionsgrafik 1024×500, mindestens 2 Screenshots
- **Werbung: ja** (die App zeigt AdMob-Anzeigen)

Symbol und Grafiken lassen sich aus dem Store-Material erzeugen, das schon
existiert: `npm run titelbilder`.

---

## Was NICHT eingebaut ist

**Google Play Games Services** (Anmeldung mit dem Google-Konto, Cloud-Speicher
für den Fortschritt). Der Fortschritt hängt aktuell an einer Zufallskennung im
Gerät, mit der Vier-Ziffern-Übertragung als Rettungsanker — genau wie im
Browser. Das ist veröffentlichungsfähig, aber ein Gerätewechsel ohne notierten
Code kostet den Stand.
