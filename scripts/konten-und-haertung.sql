/* =====================================================================
   KONTEN UND HÄRTUNG
   Ergänzung zu scripts/bestenliste.sql — Stand 20. August 2026

   WARUM ES DIESE DATEI GIBT
   Bei einer Prüfung vor dem Play-Store-Launch fiel auf: die halbe Datenbank
   stand in KEINER Datei. `spieler.konto`, die drei Kontofunktionen und alle
   Härtungen existierten nur in der laufenden Datenbank. Wer
   `bestenliste.sql` auf einem frischen Projekt ausgeführt hätte, wäre mit
   einer Datenbank dagestanden, gegen die das Spiel nicht läuft — und im
   Ernstfall (Wiederherstellung, zweites Projekt) hätte die Hälfte gefehlt.

   Reihenfolge: erst bestenliste.sql, dann diese Datei.
   ===================================================================== */


/* ---------------------------------------------------------------------
   TEIL 1 — ANMELDUNG MIT E-MAIL UND PASSWORT
   --------------------------------------------------------------------- */

/* Die Brücke zwischen Spielstand und Konto. Nullbar, weil anonymes Spielen
   der Normalfall bleibt und bleiben soll. `on delete set null`: wer sein
   Konto löscht, verliert nicht seinen Spielstand — nur die Verknüpfung. */
alter table public.spieler
  add column if not exists konto uuid unique
    references auth.users (id) on delete set null;

create index if not exists spieler_konto_idx on public.spieler (konto);


/* WARUM EIGENE FUNKTIONEN STATT `stand_laden(p_spieler)`

   Die anonymen Funktionen nehmen die Spielerkennung als PARAMETER. Für
   anonymes Spiel ist das in Ordnung: die Kennung ist eine 122-Bit-Zufallszahl,
   die nur das eigene Gerät kennt, und zu holen gibt es nichts als Münzen und
   Affen.

   Bei einem Konto wäre es fahrlässig. Wer eine fremde Kennung erriete oder
   abgriffe, schriebe in ein fremdes Konto. Diese drei Funktionen nehmen
   deshalb GAR KEINE Kennung entgegen, sondern lesen sie aus dem
   Anmeldemerkmal (`auth.uid()`). Lügen ist damit ausgeschlossen. */

create or replace function public.stand_laden_konto()
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  m int; f text[]; k uuid := auth.uid();
begin
  if k is null then raise exception 'nicht angemeldet'; end if;
  select muenzen, frei into m, f from public.spieler where konto = k;
  if not found then
    return null; -- Konto ohne Stand: der lokale gilt und wird verknüpft
  end if;
  update public.spieler set aktualisiert = now() where konto = k;
  return json_build_object('muenzen', m, 'frei', to_json(f));
end;
$function$;


create or replace function public.stand_sichern_konto(p_muenzen integer, p_frei text[])
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  max_muenzen   constant int := 100000000;
  -- MUSS zu `stand_sichern` passen, sonst driften die beiden Wege
  -- auseinander und eine der beiden Grenzen ist wirkungslos.
  max_eintraege constant int := 60;
  sauber text[];
  k uuid := auth.uid();
begin
  if k is null then raise exception 'nicht angemeldet'; end if;
  if p_muenzen is null or p_muenzen < 0 or p_muenzen > max_muenzen then
    raise exception 'unglaubwürdiger Münzstand';
  end if;

  select array_agg(distinct left(x, 32)) into sauber
  from unnest(coalesce(p_frei, '{}')) as x
  where x ~ '^[a-z0-9_-]{1,32}$';

  sauber := coalesce(sauber, '{}');
  if array_length(sauber, 1) > max_eintraege then
    raise exception 'zu viele Einträge';
  end if;

  update public.spieler
     set muenzen = p_muenzen, frei = sauber, aktualisiert = now()
   where konto = k;

  /* Kein Datensatz? Dann hat sich jemand angemeldet, ohne vorher zu
     verknüpfen. Einen neuen anlegen, damit nichts verlorengeht. */
  if not found then
    insert into public.spieler (id, konto, muenzen, frei)
    values (gen_random_uuid(), k, p_muenzen, sauber);
  end if;
end;
$function$;


/* DIE REGEL IST BEWUSST GROSSZÜGIG: `greatest()` auf Münzen, Vereinigung
   der Freischaltungen. Der Spieler kann durch das Anmelden nur gewinnen,
   nie verlieren — sonst traut sich niemand. */
create or replace function public.konto_verknuepfen(p_spieler uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  k uuid := auth.uid();
  lokal    public.spieler%rowtype;
  am_konto public.spieler%rowtype;
  neue_muenzen int;
  neue_frei    text[];
begin
  if k is null then raise exception 'nicht angemeldet'; end if;

  select * into am_konto from public.spieler where konto = k;
  select * into lokal    from public.spieler where id = p_spieler;

  -- Weder noch: leeres Konto anlegen, damit das Sichern gleich greift.
  if am_konto.id is null and lokal.id is null then
    insert into public.spieler (id, konto)
    values (coalesce(p_spieler, gen_random_uuid()), k);
    return json_build_object('muenzen', 0, 'frei', to_json('{}'::text[]));
  end if;

  -- Nur lokal: diesen Datensatz dem Konto zuschlagen.
  if am_konto.id is null then
    update public.spieler set konto = k, aktualisiert = now() where id = lokal.id;
    return json_build_object('muenzen', lokal.muenzen, 'frei', to_json(lokal.frei));
  end if;

  -- Nur am Konto: nichts zu verknüpfen, der Kontostand gilt.
  if lokal.id is null or lokal.id = am_konto.id then
    return json_build_object('muenzen', am_konto.muenzen, 'frei', to_json(am_konto.frei));
  end if;

  -- Beides da: zusammenführen, zugunsten des Spielers.
  neue_muenzen := greatest(am_konto.muenzen, lokal.muenzen);
  select array_agg(distinct x) into neue_frei
    from unnest(coalesce(am_konto.frei, '{}') || coalesce(lokal.frei, '{}')) as x;
  neue_frei := coalesce(neue_frei, '{}');

  update public.spieler
     set muenzen = neue_muenzen, frei = neue_frei, aktualisiert = now()
   where id = am_konto.id;

  /* Der lokale Datensatz bleibt LIEGEN, nur ohne Konto. Löschen wäre
     unumkehrbar, und der Vier-Ziffern-Code könnte noch darauf zeigen —
     er kostet 113 Byte, das ist der Preis für Sicherheit nicht wert. */

  return json_build_object('muenzen', neue_muenzen, 'frei', to_json(neue_frei));
end;
$function$;


/* SUPABASE ERTEILT JEDER NEUEN FUNKTION AUTOMATISCH RECHTE AN `anon`
   (ALTER DEFAULT PRIVILEGES). Ein `revoke all from public` greift dagegen
   NICHT — es entzieht nur das Recht der Rolle PUBLIC, nicht die
   ausdrückliche Erteilung an `anon`. Deshalb hier namentlich. */
revoke execute on function public.stand_laden_konto()                     from anon;
revoke execute on function public.stand_sichern_konto(integer, text[])    from anon;
revoke execute on function public.konto_verknuepfen(uuid)                 from anon;


/* ---------------------------------------------------------------------
   TEIL 2 — HÄRTUNG (20. August 2026, vor dem Play-Store-Launch)

   Drei gemessene Löcher. Die Messungen liefen als Rolle `anon` in
   Transaktionen, die anschliessend zurückgerollt wurden.
   --------------------------------------------------------------------- */

/* LOCH 1 — DER CODEVORRAT LIESS SICH IN SEKUNDEN VERBRENNEN.

   `code_vorschlag` hatte als einzige schreibende Funktion KEINE Bremse und
   prüfte nicht, ob die übergebene Kennung existiert.
   GEMESSEN: 500 Codes in 46 Millisekunden. Der gesamte Vorrat von 10 000
   wäre in gut einer Sekunde weg gewesen.

   Und DAUERHAFT: die Aufräumlogik verband `uebertrag_code` per
   `using public.spieler` — sie fand also nur Codes, zu denen es eine
   Spielerzeile GIBT. Codes auf erfundene Kennungen waren Waisen und wurden
   nie wieder frei. Danach hätte kein Spieler je wieder seinen Stand auf ein
   neues Gerät holen können.

   NACH DER HÄRTUNG GEMESSEN: 200 Versuche mit erfundenen Kennungen —
   0 Erfolge, 200 abgelehnt. Echtes Spielen unverändert: sichern, Code
   holen, zweiter Aufruf liefert denselben Code, Stand auffindbar.

   Die Funktionen stehen oben in der Datenbank; die massgebliche Fassung ist
   dort. Die drei Riegel:
     a) Mengenbremse 20/Minute, wie in `code_belegen`
     b) Ein Code geht nur an eine Kennung, die als Spieler bekannt ist
        (der Client sichert deshalb VOR dem Codeholen — Game._codeVorschlag)
     c) Waisen-Codes werden nach 7 Tagen aufgeräumt */


/* LOCH 2 — DIE DATENBANK LIESS SICH IN ~9 STUNDEN VOLLLAUFEN.

   120 neue Zeilen/Minute × bis zu 200 Freischaltungen à 32 Zeichen
   = 7 224 Byte je Zeile = rund 52 MB pro Stunde. Die 500 MB des
   Gratistarifs wären nach etwa 9,5 Stunden voll gewesen, und danach hätte
   niemand mehr spielen können. Ein Rechner und der öffentliche Schlüssel
   genügen; der Schlüssel steckt zwangsläufig in jeder APK.

   GEMESSEN an den 183 echten Spielern dieser Datenbank:
     meiste Freischaltungen: 5   Schnitt: 2,1   grösste Zeile: 73 Byte
   Die Grenze von 200 war also rund hundertmal weiter als alles Wirkliche. */

/* Der fehlende Index. In bestenliste.sql steht bei `uebertrag_code`
   ausdrücklich: "Der Index MUSS auf `angelegt` liegen … Bei public.spieler
   ist genau das schiefgegangen … Hier nicht wiederholen." Bei
   `uebertrag_code` wurde die Lehre gezogen — bei `spieler` selbst nie.
   Ohne ihn liest JEDER Aufruf mit neuer Kennung die ganze Tabelle; bei
   einigen hunderttausend Zeilen kippt die CPU, lange bevor die Platte voll
   ist. Damit wäre die Bremse selbst zur Waffe geworden. */
create index if not exists spieler_angelegt_idx on public.spieler (angelegt desc);

/* Die drei Hebel in `stand_sichern` (Fassung siehe Datenbank):
     max_eintraege        200 -> 60   (schlimmste Zeile 7 224 -> ~2 200 Byte)
     max_neue_pro_minute  120 -> 40
     max_tabelle_bytes    NEU: 200 MB harte Obergrenze

   Die harte Obergrenze ist der eigentliche Schutz: Bremsen verlangsamen
   nur, sie halten nicht auf. Ab 200 MB werden keine NEUEN anonymen Zeilen
   mehr angelegt. Bestehende Spieler speichern unverändert weiter,
   angemeldete Konten ebenso — es hört nur das Anlegen auf. Lieber ein
   Spiel, in dem Neulinge ohne Serverkopie spielen (lokal geht alles
   weiter), als ein Spiel, das für alle steht. */


/* LOCH 3 — DIE RECHTE WIDERSPRACHEN DER ARCHITEKTUR.

   Die Kopfzeile von bestenliste.sql sagt: "Die wichtigste Zeile ist eine,
   die nicht da ist" — gemeint sind die fehlenden Policies. Das galt aber
   nur für Policies, nicht für die GRANTS: `anon` und `authenticated` hatten
   auf ALLEN fünf Tabellen SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
   REFERENCES und TRIGGER.

   Für die ersten vier fängt RLS das ab. Aber TRUNCATE WIRD VON RLS
   GRUNDSÄTZLICH NICHT ABGEDECKT.
   GEMESSEN: `truncate bestenliste` als Rolle `anon` lief durch.
   NACH DER HÄRTUNG GEMESSEN: schlägt fehl.

   Heute war es nicht erreichbar (PostgREST erzeugt nie TRUNCATE, und `anon`
   hat rolcanlogin = false). Es blieb trotzdem eine geladene Waffe im Raum:
   eine künftige Tabelle ohne RLS, ein versehentliches `disable`, eine neue
   Zugriffsschicht — und die Rolle hätte Vollzugriff gehabt. */
revoke all on all tables in schema public from anon, authenticated;

/* Die Bestenliste ist der einzige öffentlich lesbare Datenbestand — Name
   und Höhe, freiwillig eingetragen, für alle sichtbar. Genau dafür ist sie
   da. Alles andere läuft ausschliesslich über die SECURITY-DEFINER-
   Funktionen, die davon unberührt bleiben (sie laufen mit den Rechten ihres
   Besitzers, nicht des Aufrufers). */
grant select on public.bestenliste to anon, authenticated;

/* AUCH FÜR KÜNFTIGE TABELLEN — sonst käme das Problem bei der nächsten
   `create table` sofort zurück. Dieselbe Falle wie bei den Funktionen. */
alter default privileges in schema public
  revoke all on tables from anon, authenticated;


/* LOCH 4 — die einzige Policy im Schema galt nur für `anon`.

   Ein ANGEMELDETER Spieler las über die Tabellen-API null Zeilen aus der
   Bestenliste. Heute fiel das nicht auf, weil Bestenliste.js immer den
   öffentlichen Schlüssel schickt und nie das Sitzungsmerkmal. Es war aber
   eine Zeitbombe: sobald die Liste einmal mit aktiver Sitzung gelesen wird,
   wäre sie für alle Angemeldeten leer — lautlos, ohne Fehlermeldung.
   GEMESSEN vorher: anon liest 16 Zeilen, angemeldet 0. Nachher: beide 16. */
drop policy if exists bestenliste_lesen_alle on public.bestenliste;
create policy bestenliste_lesen_alle
  on public.bestenliste for select
  to anon, authenticated
  using (true);


/* ---------------------------------------------------------------------
   WAS BEWUSST OFFEN BLEIBT

   Alle Mengenbremsen sind GLOBAL, nicht pro Aufrufer — die Datenbank kennt
   den Aufrufer nicht. Das heisst: wer sie dauerhaft gesättigt hält, sperrt
   auch echte Spieler aus (kein Datenverlust, nur "gerade zu viel Betrieb").
   Ohne Aufrufer-Identität ist das auf Datenbankebene nicht sauber lösbar.
   Der richtige Ort dafür wäre eine Begrenzung pro IP am Gateway.

   Für ein Spiel dieser Grösse hingenommen: der Schaden ist zeitweilig und
   erfordert einen dauerhaft laufenden Angriff, während das Volllaufen der
   Datenbank und das Verbrennen des Codevorrats DAUERHAFT waren — das war
   der Unterschied, auf den es ankam.
   --------------------------------------------------------------------- */
