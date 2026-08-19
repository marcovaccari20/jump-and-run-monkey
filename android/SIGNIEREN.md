# Play-Store-Bundle unterschreiben

Google Play nimmt nur unterschriebene Bundles an. Der Schlüssel muss **bei
dir** entstehen — nicht bei mir, nicht in der Cloud, nicht im Repository.
Sonst kennt ihn jemand anderes, und wer ihn kennt, kann eine gefälschte
Aktualisierung deiner App veröffentlichen.

## Warum das ernst ist

Play erkennt eine App an ihrer Unterschrift. Geht der Schlüssel verloren,
lässt sich die veröffentlichte App **nie mehr aktualisieren** — kein Support,
keine Ausnahme.

Der Schaden ist begrenzt, wenn du bei der Einrichtung **Play App Signing**
eingeschaltet lässt (Standard bei neuen Apps). Dann ist der Schlüssel hier
nur der *Upload*-Schlüssel, und Google kann ihn auf Antrag zurücksetzen. Den
eigentlichen App-Schlüssel verwahrt Google.

Trotzdem: `.jks`-Datei und Passwort gehören ins Backup. Passwortmanager,
nicht Notizzettel.

---

## 1. Schlüssel anlegen

Einmalig, in PowerShell im Ordner `android`:

```bash
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore jungle-climber.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jungle-climber
```

`keytool` fragt dich dann nacheinander:

| Frage | Was du eingibst |
|---|---|
| *Enter keystore password* | Ein Passwort, das **nur du** kennst. Merken bzw. in den Passwortmanager. |
| *Re-enter new password* | Dasselbe nochmal. |
| *What is your first and last name?* | Dein Name oder `Jungle Climber`. Steht nur im Zertifikat, niemand sieht es im Store. |
| *organizational unit / organization* | Darf leer bleiben (Enter). |
| *City / State / Country code* | Ortschaft, Kanton, `CH`. |
| *Is CN=… correct?* | `yes` |
| *key password for <jungle-climber>* | Enter drücken — dann gilt dasselbe Passwort wie oben. Das ist die einfachere Variante. |

`-validity 10000` sind gut 27 Jahre. Play verlangt eine Gültigkeit mindestens
bis 2033; kürzer wäre ein Problem, das erst in Jahren auffällt.

## 2. Die Datei `android/keystore.properties` anlegen

Gleicher Ordner, Inhalt:

```
storeFile=jungle-climber.jks
storePassword=DEIN_PASSWORT
keyAlias=jungle-climber
keyPassword=DEIN_PASSWORT
```

Diese Datei steht in `.gitignore` und geht nie ins Repository. Wenn du bei
Schritt 1 das Schlüsselpasswort mit Enter übersprungen hast, sind
`storePassword` und `keyPassword` identisch.

> **Die Datei muss ohne BOM gespeichert sein.** Beide folgenden Fallen sind
> hier gemessen worden, nicht vermutet — sie kosten beide dasselbe: ein
> Bundle, das aussieht wie fertig und unsigniert ist.
>
> **Falle 1 — PowerShell schreibt UTF-8 *mit* BOM.** `Out-File -Encoding utf8`
> setzt drei unsichtbare Bytes (`EF BB BF`) an den Anfang. Java liest den
> ersten Schlüssel dann als `﻿storeFile`, findet `storeFile` nicht — und
> überspringt das Signieren **kommentarlos**. Der Bau meldet
> `BUILD SUCCESSFUL`. Lege die Datei mit einem Editor an (VS Code, Notepad)
> oder in Git Bash:
>
> ```bash
> printf 'storeFile=jungle-climber.jks\nstorePassword=DEIN_PASSWORT\nkeyAlias=jungle-climber\nkeyPassword=DEIN_PASSWORT\n' > android/keystore.properties
> ```
>
> **Falle 2 — Gradle merkt die neue Datei nicht.** `keystore.properties`
> zählt für Gradle nicht als Eingabe. Wer sie *nach* einem ersten Bau anlegt,
> bekommt `bundleRelease UP-TO-DATE` und behält das alte, unsignierte Bundle.
> Beim ersten Mal deshalb vorher löschen:
>
> ```bash
> rm -f android/app/build/outputs/bundle/release/app-release.aab
> ```

## 3. Bundle bauen

```bash
cd android && ./gradlew bundleRelease
```

Ergebnis: `android/app/build/outputs/bundle/release/app-release.aab`

Ohne `keystore.properties` läuft der Bau ebenfalls durch, liefert aber ein
**unsigniertes** Bundle — Play weist das ab. Das ist Absicht: so baut auch
jemand ohne Schlüssel den Quelltext durch.

## 4. Prüfen, ob wirklich unterschrieben wurde

```bash
cd android && unzip -l app/build/outputs/bundle/release/app-release.aab | grep -iE "\.(RSA|SF)$"
```

Kommt nichts zurück, ist das Bundle unsigniert — dann wurde
`keystore.properties` nicht gefunden.

---

## Bei jeder neuen Fassung

`versionCode` in `android/app/build.gradle` **muss** hochgezählt werden — Play
lehnt eine Fassung mit gleicher oder kleinerer Nummer ab. `versionName` ist
der Text, den die Nutzer sehen (`1.0`, `1.1`, …), und darf frei gewählt
werden.

Vorher nicht vergessen:

```bash
npm run build && npx cap sync android
```

Ohne `cap sync` steckt im Bundle der **alte** Spielstand — der Bau meldet
keinen Fehler, die App sieht nur aus wie letzte Woche.
