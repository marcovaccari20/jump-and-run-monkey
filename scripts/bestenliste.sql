-- ============================================================================
--  Weltweite Bestenliste für Jungle Climber — Supabase
--
--  EINMAL im SQL-Editor des Projekts ausführen. Danach in src/config.js unter
--  `bestenliste` die Projekt-URL und den öffentlichen anon-Schlüssel
--  eintragen. Ohne die beiden Werte läuft das Spiel weiter mit der lokalen
--  Liste — es geht also nichts kaputt, solange das hier nicht steht.
--
--  DIE WICHTIGSTE ZEILE IST EINE, DIE NICHT DA IST
--  Für `anon` gibt es KEINE insert-Regel. Ohne Regel ist die Operation
--  verboten. Eingetragen wird ausschliesslich über die Funktion unten, und
--  die prüft vorher. Wer stattdessen `insert` freigäbe, könnte sich jede
--  beliebige Zeile schreiben — inklusive Zeitstempel und fremder Namen.
-- ============================================================================

create table if not exists public.bestenliste (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 12),
  score      int  not null check (score >= 0),
  played_ms  int  not null,
  -- Wurde der Lauf per Werbung verlängert? Die lokale Liste kennzeichnet das
  -- seit jeher mit einem Zeichen; ohne diese Spalte fehlte es weltweit.
  ad         boolean not null default false,
  created_at timestamptz not null default now()
);

-- Nachrüsten, falls die Tabelle aus einer früheren Fassung stammt.
alter table public.bestenliste add column if not exists ad boolean not null default false;

-- Die Liste wird immer nach Punkten sortiert gelesen. Der zweite Schlüssel
-- macht die Reihenfolge bei Gleichstand stabil — sonst springen zwei Spieler
-- mit derselben Punktzahl zwischen zwei Abrufen hin und her.
create index if not exists bestenliste_score_idx
  on public.bestenliste (score desc, created_at asc);

/* EIN EINTRAG JE NAME.
 *
 * Ohne das belegt ein einzelner guter Spieler alle zehn Plätze mit seinen
 * zehn besten Läufen, und die Liste zeigt statt zehn Menschen einen. Der
 * Index erzwingt es und beschleunigt zugleich das Nachschlagen in der
 * Eintragen-Funktion. `lower()`: sonst wären AFFE, Affe und aFFE drei
 * verschiedene Spieler.
 *
 * ERST AUFRÄUMEN, DANN DEN INDEX.
 * Auf einer Tabelle aus der Vorgängerfassung stehen mit Sicherheit mehrere
 * Zeilen je Name — die liess sie ausdrücklich zu. Ein `create unique index`
 * darauf scheitert. Der SQL-Editor von Supabase fährt dieses Skript in EINER
 * Transaktion: alles rollt zurück, auch die neue Eintragen-Funktion, und die
 * ALTE, verwundbare bleibt live. Man hätte eine grüne Meldung erwartet und
 * eine offene Tür bekommen. */
delete from public.bestenliste a
using public.bestenliste b
where lower(btrim(a.name)) = lower(btrim(b.name))
  and (a.score < b.score or (a.score = b.score and a.id > b.id));

create unique index if not exists bestenliste_name_idx
  on public.bestenliste (lower(btrim(name)));

-- Für die Sperrfrist und den Flutschutz: beide zählen über einen Zeitraum.
create index if not exists bestenliste_zeit_idx
  on public.bestenliste (created_at desc);

alter table public.bestenliste enable row level security;

/* ERST ALLE ALTEN REGELN WEG, DANN DIE EINE RICHTIGE.
 *
 * `drop policy if exists lesen_alle` allein reichte nicht: es löscht nur die
 * Regel mit GENAU diesem Namen. Hätte eine Vorgängerfassung eine anders
 * benannte Regel angelegt — vor allem eine `for insert to anon` — bliebe die
 * stehen und aktiv. Dann stünde die Tür offen, die die Kopfzeile dieser
 * Datei ausdrücklich zumauern will, und zwar unbemerkt.
 *
 * Deshalb hier über den Katalog: was auch immer da ist, kommt weg. */
do $$
declare r record;
begin
  -- Tabellenname MUSS aus derselben Zeile kommen: derselbe Regelname darf auf
  -- mehreren Tabellen existieren, eine Unterabfrage nach dem Namen allein
  -- träfe irgendeine davon.
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('bestenliste', 'lauf', 'spieler')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

-- Lesen darf jeder. Es ist eine Bestenliste.
create policy lesen_alle on public.bestenliste
  for select to anon using (true);

-- KEINE insert/update/delete-Regel für anon. Das ist Absicht, siehe oben.


-- ============================================================================
--  WIE HOCH KANN MAN IN DIESER ZEIT ÜBERHAUPT KOMMEN?
--
--  Die vorige Fassung verglich hier eine feste Zahl: 9 Meter je Sekunde.
--  Das war ein Fehler, und zwar ein teurer. 9 ist die MOMENTANE Höchstrate,
--  und die wird erst nach knapp 23 Minuten Spielzeit überhaupt erreicht.
--  Verglichen wurde sie aber mit dem DURCHSCHNITT über den ganzen Lauf, und
--  der liegt bei realistischen Läufen zwischen 2.4 und 3.5 m/s.
--
--  Gemessene Folge: 999999 Meter wurden zwar abgewiesen — dafür reichte die
--  erlaubte Spielzeit nicht. Aber ein einziger Aufruf mit
--      {"p_score": 64800, "p_played_ms": 7200000}
--  kam durch, ohne dass der Angreifer das Spiel je gestartet hätte. 64 800
--  Meter schlägt nie wieder jemand; die Liste wäre damit genauso tot wie mit
--  999999.
--
--  Diese Funktion rechnet stattdessen die echte Kurve nach.
--
--  HERLEITUNG (die Zahlen stehen alle in src/config.js unter `difficulty`)
--    tempo(t)   = min(tempo_max, tempo_start * pro_wand^(tempo_exp*t/sek_pro_wand))
--    scroll(t)  = tempo(t) * scroll_anteil
--    rate(t)    = scroll(t) + klettern_max      <- "W" dauerhaft gedrückt
--  Das Integral von rate über t ergibt die Höhe. Weil tempo exponentiell
--  wächst und dann gedeckelt wird, zerfällt es in zwei Abschnitte.
--
--  WARUM DAS EINE OBERGRENZE IST, DIE NIEMAND ERREICHT
--  Die Rechnung unterstellt, dass durchgehend senkrecht geklettert wird. Wer
--  ausweicht, bewegt sich schräg, und dann zählt der Kletteranteil nur noch
--  mit Faktor 0.707 (src/input/InputHandler.js). Ausweichen muss aber jeder,
--  sonst ist der Lauf vorbei. Der echte Wert liegt also deutlich darunter.
--
--  ⚠ WIRD IN src/config.js AN DER SCHWIERIGKEIT GEDREHT, MUSS ES HIER NACH-
--  GEZOGEN WERDEN. Zu enge Werte weisen ehrliche Läufe ab, zu weite lassen
--  Betrug durch. Die sieben Konstanten unten sind die einzige Stelle.
-- ============================================================================

create or replace function public.max_hoehe(p_sekunden numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  tempo_start   constant numeric := 3.8;   -- difficulty.tempo.start
  tempo_max     constant numeric := 16.0;  -- difficulty.tempo.max
  scroll_anteil constant numeric := 0.42;  -- difficulty.tempo.scrollAnteil
  pro_wand      constant numeric := 1.25;  -- difficulty.proWand
  sek_pro_wand  constant numeric := 132;   -- difficulty.sekundenProWand
  tempo_exp     constant numeric := 0.62;  -- difficulty.tempoExponent
  klettern_max  constant numeric := 1.3;   -- grösster characters[].climbAssist (weiss)

  -- Luft nach oben für Bildraten-Schwankungen und Rundungsfehler beim
  -- Aufsummieren über zehntausende Frames. 8 % sind reichlich; die Lücke
  -- zum echten Spielerwert ist ein Vielfaches davon.
  reserve       constant numeric := 1.08;

  k        numeric;  -- Wachstum des Tempos je Sekunde
  v0       numeric;  -- Scrollgeschwindigkeit bei t = 0
  t_deckel numeric;  -- ab hier ist das Tempo am Anschlag
  s_deckel numeric;  -- Höhe zu diesem Zeitpunkt
  t        numeric;
begin
  t := greatest(0, p_sekunden);
  k  := ln(pro_wand) * tempo_exp / sek_pro_wand;
  v0 := tempo_start * scroll_anteil;

  t_deckel := ln(tempo_max / tempo_start) / k;
  s_deckel := (v0 / k) * (exp(k * t_deckel) - 1) + klettern_max * t_deckel;

  if t <= t_deckel then
    return reserve * ((v0 / k) * (exp(k * t) - 1) + klettern_max * t);
  end if;

  return reserve * (s_deckel + (tempo_max * scroll_anteil + klettern_max) * (t - t_deckel));
end;
$$;

/* NICHT von aussen aufrufbar.
 *
 * Als einzige Funktion hatte diese kein `revoke` — und Postgres vergibt
 * EXECUTE standardmässig an PUBLIC, Supabase zusätzlich direkt an `anon`.
 * Damit stand
 *     POST /rest/v1/rpc/max_hoehe {"p_sekunden": 7200}
 * jedem offen: genau das Orakel, das die zahlenlose Fehlermeldung weiter
 * unten schliessen soll. Man hätte die Grenze nicht mehr raten müssen,
 * sondern einfach abgefragt.
 *
 * `anon` und `authenticated` einzeln mitnehmen: `revoke ... from public`
 * allein entfernt die Rechte nicht, die Supabase per default privileges
 * direkt an diese Rollen vergibt. */
revoke all on function public.max_hoehe(numeric) from public, anon, authenticated;


-- ============================================================================
--  Eintragen — die einzige Tür hinein
--
--  `security definer` heisst: die Funktion läuft mit den Rechten ihres
--  Besitzers, nicht mit denen des Aufrufers. Nur deshalb darf sie schreiben,
--  obwohl `anon` es nicht darf.
--
--  GRENZEN, EHRLICH BENANNT
--  Das hier macht die Liste nicht fälschungssicher. Der anon-Schlüssel steht
--  zwangsläufig im ausgelieferten JavaScript, also kann jeder diese Funktion
--  direkt aufrufen. Was die Prüfungen leisten: sie begrenzen den Schaden auf
--  einen Wert, den auch ein sehr guter Mensch erreichen könnte. Wirklich
--  sicher wäre nur, den kompletten Spielverlauf mitzuschicken und
--  serverseitig nachzurechnen — für ein Casual-Spiel unverhältnismässig.
-- ============================================================================

/* ---------------------------------------------------------------------------
 *  DIE SPIELZEIT MISST DER SERVER, NICHT DER BROWSER
 *
 *  Die vorige Fassung nahm `p_played_ms` aus dem Spiel entgegen. Damit
 *  bestimmte der Angreifer BEIDE Zahlen — er gab einfach die höchste erlaubte
 *  Spielzeit an und dazu den Punktestand, der laut Kurve dazu passt. Jede
 *  Verhältnisprüfung ist unter dieser Bedingung wertlos, egal wie genau die
 *  Kurve stimmt.
 *
 *  Deshalb holt sich das Spiel beim Rundenstart eine Marke ab. Der Server
 *  stempelt sie mit SEINER Uhr; beim Eintragen rechnet er die verstrichene
 *  Zeit selbst aus. Wer 57 000 Meter behaupten will, muss die Marke zwei
 *  echte Stunden lang liegen lassen.
 *
 *  WAS DAS NICHT LEISTET, ehrlich gesagt: Marken lassen sich auf Vorrat
 *  anlegen und altern lassen. Deshalb sind sie rationiert und verfallen. Aus
 *  "ein Aufruf" wird damit "geplant, gewartet und rationiert" — unmöglich
 *  wird es nicht. Bei einem Browserspiel ohne Anmeldung ist das die Grenze
 *  des Machbaren.
 * ------------------------------------------------------------------------- */

create table if not exists public.lauf (
  id           uuid primary key default gen_random_uuid(),
  gestartet    timestamptz not null default now(),
  benutzt      boolean not null default false,
  -- Lebenszeichen: siehe lauf_tick() weiter unten.
  ticks        int not null default 0,
  letzter_tick timestamptz
);

alter table public.lauf add column if not exists ticks int not null default 0;
alter table public.lauf add column if not exists letzter_tick timestamptz;

create index if not exists lauf_gestartet_idx on public.lauf (gestartet desc);

alter table public.lauf enable row level security;
-- Keine einzige Policy: an diese Tabelle kommt `anon` nur über die Funktionen.

create or replace function public.lauf_start()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Rationierung, damit niemand Marken auf Vorrat anlegt. 240/min ist weit
  -- über jedem echten Andrang für ein Spiel dieser Grösse.
  max_pro_minute constant int := 240;
  neue uuid;
begin
  if (
    select count(*) from public.lauf where gestartet > now() - interval '1 minute'
  ) >= max_pro_minute then
    raise exception 'gerade zu viel Betrieb, bitte kurz warten';
  end if;

  -- Verfallene Marken wegräumen: sie sind älter als die längste erlaubte
  -- Spielzeit und damit ohnehin wertlos.
  delete from public.lauf where gestartet < now() - interval '3 hours';

  insert into public.lauf default values returning id into neue;
  return neue;
end;
$$;

revoke all on function public.lauf_start() from public;
grant execute on function public.lauf_start() to anon;


/* ---------------------------------------------------------------------------
 *  LEBENSZEICHEN — warum das Alter einer Marke allein nicht reicht
 *
 *  Die Serveruhr allein war noch zu billig auszutricksen:
 *
 *      curl .../rpc/lauf_start     # eine Anfrage
 *      sleep 7100                  # läuft nebenbei, kostet nichts
 *      curl .../rpc/eintragen -d '{"p_score":56900}'
 *
 *  Zwei Anfragen, und die Liste war tot. Ich hatte an dieser Stelle
 *  geschrieben, Betrug koste damit "dieselbe Zeit wie ehrliches Spielen".
 *  Das war falsch: ein `sleep` läuft im Hintergrund, beliebig oft parallel,
 *  ohne Aufmerksamkeit. Siebenundvierzig Minuten ununterbrochenes Ausweichen
 *  bei einem Treffer Tod sind etwas völlig anderes.
 *
 *  Deshalb zählt jetzt nicht das Alter, sondern die Zahl der Lebenszeichen.
 *  Das Spiel meldet sich alle `tick_sekunden` einmal; angerechnet wird
 *
 *      min( verstrichene Uhrzeit , ticks * tick_sekunden * toleranz )
 *
 *  Wer eine Stunde behaupten will, muss eine Stunde lang regelmässig
 *  Anfragen schicken — und die sind zählbar, rationiert und auffällig.
 *  Die Toleranz von 3.0 ist da, damit ein ehrlicher Spieler auch dann noch
 *  durchkommt, wenn zwei von drei Lebenszeichen im Netz verloren gehen.
 * ------------------------------------------------------------------------- */

create or replace function public.lauf_tick(p_lauf uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Muss zu CONFIG.bestenliste.tickSekunden passen.
  tick_sekunden constant numeric := 20;
  letzter timestamptz;
begin
  select letzter_tick into letzter from public.lauf
  where id = p_lauf and not benutzt for update;

  if not found then
    return; -- unbekannt oder schon eingetragen: still ignorieren
  end if;

  /* Schneller als der Takt zählt nicht. Sonst schickt ein Angreifer die
   * Lebenszeichen einfach in einer Schleife hintereinander und hat in zehn
   * Sekunden eine Stunde "gespielt". Etwas Nachsicht (0.8), weil Timer im
   * Browser nie exakt laufen. */
  if letzter is not null and now() - letzter < (tick_sekunden * 0.8) * interval '1 second' then
    return;
  end if;

  update public.lauf
  set ticks = ticks + 1, letzter_tick = now()
  where id = p_lauf;
end;
$$;

revoke all on function public.lauf_tick(uuid) from public;
grant execute on function public.lauf_tick(uuid) to anon;


create or replace function public.eintragen(
  p_lauf  uuid,
  p_name  text,
  p_score int,
  p_ad    boolean default false
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  min_spielzeit constant numeric := 4;    -- Sekunden; darunter ist es kein Lauf
  max_spielzeit constant numeric := 7200; -- darüber auch nicht
  -- Flutschutz über ALLE Namen. Die Sperrfrist je Name allein nützt nichts:
  -- wer zufällige Namen schickt, umgeht sie vollständig.
  max_gesamt_pro_minute constant int := 120;

  -- Muss zu CONFIG.bestenliste.tickSekunden passen.
  tick_sekunden constant numeric := 20;
  -- Nachsicht für verlorene Lebenszeichen (schlechtes Netz, Bildratenhänger).
  toleranz      constant numeric := 3.0;

  sauber    text;
  grenze    numeric;
  rang      int;
  spielzeit numeric;
  uhrzeit   numeric;
  start_zeit timestamptz;
  schon_weg boolean;
  gezaehlt  int;
begin
  sauber := btrim(coalesce(p_name, ''));
  if char_length(sauber) = 0 then
    raise exception 'Name fehlt';
  end if;
  /* Nach dem Kürzen NOCHMAL trimmen. Fällt der Schnitt auf ein Leerzeichen,
   * endet der Name darauf — gespeichert wird dann dieser Wert, der
   * Indexschlüssel ist aber `lower(btrim(name))` ohne das Leerzeichen. Die
   * Rangabfrage unten fand ihren eigenen Eintrag dadurch nicht wieder und
   * meldete jedem Betroffenen Platz 1. */
  sauber := btrim(left(sauber, 12));

  if p_score < 0 then
    raise exception 'negativer Punktestand';
  end if;

  -- Die Marke einlösen. `for update` sperrt die Zeile, damit zwei gleichzeitige
  -- Aufrufe sie nicht beide verbrauchen.
  select gestartet, benutzt, ticks into start_zeit, schon_weg, gezaehlt
  from public.lauf where id = p_lauf for update;

  if not found then
    raise exception 'unbekannter Lauf';
  end if;
  if schon_weg then
    raise exception 'dieser Lauf wurde bereits eingetragen';
  end if;

  /* SERVERZEIT. Das ist der ganze Punkt.
   *
   * Sie läuft weiter, während das Spiel pausiert, ein Werbespot läuft oder
   * der Tab im Hintergrund liegt — sie ist also IMMER länger als die echte
   * Spielzeit. Nachgerechnet: das macht die Prüfung nur lockerer, nie
   * strenger, denn die Schranke wächst mit der Uhr und der Punktestand
   * nicht. Ein ehrlicher Spieler wird dadurch nie abgewiesen.
   *
   * ZWEI AUSNAHMEN, damit sie hier stehen und nicht überraschen:
   *  - `max_spielzeit` unten: wer den Game-Over-Bildschirm zwei Stunden offen
   *    liegen lässt (oder über Mittag pausiert, oder den Laptop zuklappt),
   *    wird abgewiesen. Über drei Stunden ist die Marke sogar weggeräumt,
   *    dann lautet die Meldung "unbekannter Lauf".
   *  - Die Gegenrichtung: der Stempel entsteht erst, wenn `lauf_start` beim
   *    Server ankommt, also NACH dem echten Rundenstart. Um diese Latenz ist
   *    die gemessene Zeit KÜRZER als die gespielte. Dagegen stehen der
   *    Nachlauf bis zur Namenseingabe und die 8 % Reserve in `max_hoehe`;
   *    bei einem Vier-Sekunden-Lauf bräuchte es rund zwei Sekunden Latenz,
   *    damit es kippt. Selten, aber nicht unmöglich. */
  uhrzeit := extract(epoch from (now() - start_zeit));

  if uhrzeit < min_spielzeit or uhrzeit > max_spielzeit then
    raise exception 'unglaubwürdige Spielzeit';
  end if;

  /* ANGERECHNET WIRD DAS KLEINERE VON BEIDEM.
   *
   * Die Uhrzeit begrenzt nach oben (man kann nicht mehr gespielt haben, als
   * vergangen ist). Die Lebenszeichen begrenzen ebenfalls nach oben — und
   * die sind es, die reines Warten wertlos machen: wer schläft, meldet sich
   * nicht, und ohne Meldungen zählt die vergangene Zeit nicht. */
  /* Das `+ 1` ist ein Freibetrag von genau einer Taktperiode, und er ist
   * nicht Bequemlichkeit, sondern Notwendigkeit:
   *
   * Ohne ihn wurde ein Lauf, der vor dem ersten Lebenszeichen endet, mit
   * NULL Sekunden bewertet — und damit jeder Punktestand über null als
   * unplausibel abgewiesen. Wer nach zwölf Sekunden stirbt, bekam eine
   * Betrugsmeldung. Dasselbe traf einen ehrlichen Lauf, bei dem das einzige
   * Lebenszeichen im Netz verloren ging.
   *
   * Was es kostet: Wer nur wartet und nie ein Lebenszeichen schickt, darf
   * jetzt bis zu max_hoehe(60 s) = rund 190 Meter behaupten. Das liegt weit
   * unter jedem Lauf, der es in die Liste schafft. */
  spielzeit := least(uhrzeit, (gezaehlt + 1) * tick_sekunden * toleranz);

  -- Der eigentliche Filter: mehr Meter, als in der Zeit überhaupt zu
  -- schaffen sind, gibt es nicht.
  grenze := public.max_hoehe(spielzeit);
  if p_score > grenze then
    /* OHNE ZAHLEN. Die Meldung nannte vorher die exakte Grenze und die
     * verstrichenen Sekunden — ein Orakel: einmal 999999 schicken, die
     * Grenze ablesen, genau die eintragen. Und weil ein `raise` die ganze
     * Transaktion zurückdreht, überlebt die Marke jeden Fehlversuch. */
    raise exception 'Punktestand passt nicht zum Spielverlauf';
  end if;

  update public.lauf set benutzt = true where id = p_lauf;

  if (
    select count(*) from public.bestenliste
    where created_at > now() - interval '1 minute'
  ) >= max_gesamt_pro_minute then
    raise exception 'gerade zu viel Betrieb, bitte kurz warten';
  end if;

  /* HIER STAND EINE SPERRFRIST JE NAME (höchstens 5 Einträge/Minute).
   * Sie war toter Code: durch den unique index gibt es je Name genau EINE
   * Zeile, `count(*) >= 5` kann nie zutreffen. Was diese Sperrfrist leisten
   * sollte, leistet der Index selbst — und gegen zufällige Namen half sie
   * ohnehin nie, dafür ist der Flutschutz oben da. */

  /* Ein Eintrag je Name, der beste zählt. Ein schlechterer Lauf darf den
   * eigenen Rekord nicht überschreiben — sonst verlöre man seine Bestmarke
   * dadurch, dass man nochmal spielt.
   *
   * `created_at` bleibt beim Verbessern stehen. Es ist der zweite
   * Sortierschlüssel: wer den Zeitstempel neu setzte, rutschte bei
   * Punktegleichstand hinter Spieler, die schon länger dastehen — man
   * verlöre also einen Platz, indem man seinen eigenen Rekord einstellt. */
  insert into public.bestenliste (name, score, played_ms, ad)
  values (sauber, p_score, round(spielzeit * 1000), coalesce(p_ad, false))
  on conflict (lower(btrim(name))) do update
    set score     = excluded.score,
        played_ms = excluded.played_ms,
        ad        = excluded.ad
    where public.bestenliste.score < excluded.score;

  /* Platz zurückgeben. Gezählt wird gegen den EINGETRAGENEN Wert, nicht
   * gegen p_score: wer seinen eigenen besseren Rekord nicht überbietet,
   * bleibt mit dem alten Wert stehen — und soll dann auch dessen Platz
   * genannt bekommen, nicht den des schwächeren Laufs. */
  select count(*) + 1 into rang
  from public.bestenliste
  where score > (
    select score from public.bestenliste where lower(btrim(name)) = lower(sauber)
  );
  return rang;
end;
$$;

-- Aufrufbar für alle, aber eben nur DIESE Funktion.
revoke all on function public.eintragen(uuid, text, int, boolean) from public;
grant execute on function public.eintragen(uuid, text, int, boolean) to anon;

/* ALTE FASSUNGEN ENTFERNEN.
 * Sie nahmen die Spielzeit aus dem Browser entgegen. Bliebe eine davon
 * stehen, stünde daneben eine Tür ohne die Serveruhr offen — und ein
 * Angreifer nimmt selbstverständlich die unverschlossene. */
drop function if exists public.eintragen(text, int, int);
drop function if exists public.eintragen(text, int, int, boolean);


-- ============================================================================
--  FORTSCHRITT: Münzen, freigeschaltete Affen und Fellfarben
--
--  Gebunden an eine zufällige Kennung, die das Spiel selbst vergibt und im
--  Browser ablegt. Kein Konto, keine Anmeldung, keine E-Mail — und damit auch
--  nichts, was auf eine Person zeigt. Dieselbe Kennung ist der
--  Wiederherstellungscode, mit dem man seinen Stand auf ein anderes Gerät
--  holt.
--
--  WAS HIER BEWUSST NICHT GEPRÜFT WIRD
--  Der Münzstand kommt ungeprüft vom Client. Er liesse sich fälschen — und
--  das ist hingenommen, weil Münzen ausschliesslich Aussehen kaufen: Affen
--  und Fellfarben, die alle gleich stark sind. Höhe kauft man damit nie, und
--  die Bestenliste kennt keine Münzen. Wer sich hier betrügt, betrügt sich
--  um das Spiel, nicht um die Rangliste.
--
--  Eine Obergrenze steht trotzdem drin, damit niemand aus Spass
--  9 Billiarden hineinschreibt und die Anzeige zerlegt.
-- ============================================================================

create table if not exists public.spieler (
  id           uuid primary key,
  muenzen      int not null default 0 check (muenzen >= 0 and muenzen <= 100000000),
  frei         text[] not null default '{}',
  aktualisiert timestamptz not null default now(),
  angelegt     timestamptz not null default now()
);

alter table public.spieler enable row level security;
-- Keine einzige Policy: an diese Tabelle kommt `anon` nur über die Funktionen
-- unten. Sonst könnte jeder die Stände aller anderen lesen und überschreiben.

create index if not exists spieler_aktualisiert_idx on public.spieler (aktualisiert desc);


create or replace function public.stand_laden(p_spieler uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  m int;
  f text[];
begin
  select muenzen, frei into m, f from public.spieler where id = p_spieler;
  if not found then
    return null; -- neuer Spieler: der lokale Stand gilt
  end if;
  -- Nebenbei: zeigt, dass die Kennung noch benutzt wird (fürs Aufräumen).
  update public.spieler set aktualisiert = now() where id = p_spieler;
  return json_build_object('muenzen', m, 'frei', to_json(f));
end;
$$;

revoke all on function public.stand_laden(uuid) from public;
grant execute on function public.stand_laden(uuid) to anon;


create or replace function public.stand_sichern(
  p_spieler uuid,
  p_muenzen int,
  p_frei    text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  max_muenzen constant int := 100000000;
  max_eintraege constant int := 200; -- weit über allem, was es je geben wird
  -- Flutschutz. Die einzige schreibende Funktion, die vorher keinen hatte:
  -- mit zufälligen Kennungen liess sich die Tabelle unbegrenzt füllen.
  max_neue_pro_minute constant int := 120;
  sauber text[];
begin
  if p_spieler is null then
    raise exception 'keine Spielerkennung';
  end if;
  if p_muenzen is null or p_muenzen < 0 or p_muenzen > max_muenzen then
    raise exception 'unglaubwürdiger Münzstand';
  end if;

  /* Die Liste beschneiden: Länge, Anzahl, und nur Zeichen, die als Bezeichner
   * überhaupt vorkommen. Nicht gegen Betrug — gegen versehentlichen und
   * absichtlichen Müll, der die Tabelle aufbläht. */
  select array_agg(distinct left(x, 32))
    into sauber
  from unnest(coalesce(p_frei, '{}')) as x
  where x ~ '^[a-z0-9_-]{1,32}$';

  sauber := coalesce(sauber, '{}');
  if array_length(sauber, 1) > max_eintraege then
    raise exception 'zu viele Einträge';
  end if;

  /* Nur NEUE Kennungen rationieren. Wer schon eine Zeile hat, speichert
   * beliebig oft — das ist der ehrliche Normalfall (jede eingesammelte Münze
   * schreibt). Gebremst wird nur das Anlegen, und genau das ist der Hebel
   * zum Vollmüllen. */
  if not exists (select 1 from public.spieler where id = p_spieler) then
    if (
      select count(*) from public.spieler where angelegt > now() - interval '1 minute'
    ) >= max_neue_pro_minute then
      raise exception 'gerade zu viel Betrieb, bitte kurz warten';
    end if;
  end if;

  insert into public.spieler (id, muenzen, frei)
  values (p_spieler, p_muenzen, sauber)
  on conflict (id) do update
    set muenzen      = excluded.muenzen,
        frei         = excluded.frei,
        aktualisiert = now();
end;
$$;

revoke all on function public.stand_sichern(uuid, int, text[]) from public;
grant execute on function public.stand_sichern(uuid, int, text[]) to anon;


-- ============================================================================
--  ÜBERTRAGUNGSCODE: vier Ziffern statt der 36-stelligen Kennung
--
--  Die Kennung selbst als Wiederherstellungscode zu nehmen war sicher, aber
--  unbenutzbar: niemand tippt 36 Zeichen auf einem Handy ab. Deshalb kann
--  sich der Spieler VIER ZIFFERN aussuchen, die noch frei sind. Die Kennung
--  bleibt intern der Schlüssel; der Code ist nur ein Zeiger darauf. An
--  stand_laden/stand_sichern ändert sich nichts.
--
--  WAS DAS KOSTET — offen benannt, weil es eine bewusste Entscheidung war
--
--  Vier Ziffern sind ZEHNTAUSEND Möglichkeiten. Daraus folgen zwei Dinge,
--  die keine noch so gute Implementierung wegzaubert:
--
--    1. Es kann nie mehr als 10 000 vergebene Codes gleichzeitig geben.
--       Abgefedert dadurch, dass ein Code ERST BEIM ÜBERTRAGEN vergeben
--       wird — wer nie das Gerät wechselt, verbraucht keinen.
--    2. Der Code ist kein Geheimnis. Wer durchprobiert, landet in fremden
--       Ständen. Die Bremse unten macht das langsam und auffällig, nicht
--       unmöglich.
--
--  Der Schaden bleibt begrenzt: Münzen kaufen ausschliesslich Aussehen,
--  Höhe kauft man damit nie, und die Bestenliste kennt keine Münzen. Wer
--  einen Code errät, bekommt fremde Fellfarben — keinen Ranglistenplatz.
-- ============================================================================

create table if not exists public.uebertrag_code (
  -- Genau vier Ziffern, führende Null erlaubt ('0042'). Deshalb text mit
  -- Prüfung und nicht int — 42 und 0042 wären sonst derselbe Code.
  code     text primary key check (code ~ '^[0-9]{4}$'),
  -- Ein Spieler hat höchstens einen Code. Wer einen neuen wählt, gibt den
  -- alten frei (siehe code_belegen).
  spieler  uuid not null unique,
  angelegt timestamptz not null default now(),
  benutzt  timestamptz
);

alter table public.uebertrag_code enable row level security;
-- Keine Policy: `anon` kommt ausschliesslich über die Funktionen unten heran.
-- Mit einer Lesepolicy wäre die ganze Übung sinnlos — dann liesse sich die
-- vollständige Codeliste in einer einzigen Anfrage abholen.

create index if not exists uebertrag_code_spieler_idx
  on public.uebertrag_code (spieler);

/* Der Index MUSS auf `angelegt` liegen, nicht auf irgendeiner Spalte.
 *
 * Die Rationierung in code_belegen zählt über `angelegt`. Bei public.spieler
 * ist genau das schiefgegangen: dort zählt die Bremse über `angelegt`,
 * indiziert ist aber `aktualisiert` — jeder Aufruf mit neuer Kennung liest
 * seitdem die ganze Tabelle. Hier nicht wiederholen. */
create index if not exists uebertrag_code_angelegt_idx
  on public.uebertrag_code (angelegt desc);


/* ---------------------------------------------------------------------------
 *  DIE BREMSE — und warum sie auf FEHLVERSUCHE zählt
 *
 *  Wer Codes durchprobiert, erzeugt fast nur Fehlschläge: von 10 000
 *  Versuchen treffen so viele, wie es vergebene Codes gibt. Ein ehrlicher
 *  Spieler dagegen tippt seinen eigenen Code und trifft beim ersten Mal.
 *
 *  Deshalb wird nicht die Zahl der Anfragen begrenzt, sondern die Zahl der
 *  ERFOLGLOSEN. Der ehrliche Fall läuft dadurch praktisch nie in die Bremse,
 *  während das Durchprobieren sofort ausgebremst wird.
 *
 *  Eine Begrenzung je Aufrufer wäre schöner, ist hier aber nicht zu haben:
 *  hinter PostgREST sieht die Datenbank den Verbindungspool, nicht den
 *  Spieler. Die Bremse gilt deshalb GLOBAL. Bei 10 Fehlversuchen je Minute
 *  dauert das Durchprobieren aller 10 000 Codes über sechzehn Stunden und
 *  hinterlässt eine Spur, die man sieht.
 * ------------------------------------------------------------------------- */

create table if not exists public.code_versuch (
  id        bigserial primary key,
  zeitpunkt timestamptz not null default now(),
  treffer   boolean not null
);

alter table public.code_versuch enable row level security;

-- Passgenau zur Abfrage der Bremse (`treffer = false and zeitpunkt > …`):
-- ein Teilindex nur über die Fehlversuche. Er bleibt winzig, weil erfolgreiche
-- Aufrufe gar nicht erst hineingehören.
create index if not exists code_versuch_fehler_idx
  on public.code_versuch (zeitpunkt desc) where treffer = false;

-- Für das Aufräumen alter Zeilen (über alle Versuche).
create index if not exists code_versuch_zeit_idx
  on public.code_versuch (zeitpunkt desc);


-- ----------------------------------------------------------------- belegen --
-- Vergibt einen selbst gewählten Code. Fehler sind hier ABSICHTLICH
-- unterscheidbar ("schon vergeben"), denn der Spieler muss ja erfahren, dass
-- er sich einen anderen aussuchen soll. Beim AUFLÖSEN ist das anders (unten).
create or replace function public.code_belegen(p_spieler uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Grenze als benannte Konstante, wie bei lauf_start und stand_sichern.
  max_pro_minute constant int := 20;
  sauber text := btrim(coalesce(p_code, ''));
  inhaber uuid;
begin
  if sauber !~ '^[0-9]{4}$' then
    raise exception 'Der Code muss aus genau vier Ziffern bestehen.';
  end if;

  -- Rationierung wie bei lauf_start: verhindert, dass jemand in einem Rutsch
  -- alle freien Codes belegt und damit neuen Spielern die Tür zumauert.
  if (
    select count(*) from public.uebertrag_code
    where angelegt > now() - interval '1 minute'
  ) >= max_pro_minute then
    raise exception 'gerade zu viel Betrieb, bitte kurz warten';
  end if;

  -- Verwaiste Codes freigeben: gehört der Code zu einem Stand, der seit über
  -- einem Jahr nicht angefasst wurde, ist er wieder zu haben. Ohne das wäre
  -- der Vorrat von 10 000 endgültig, sobald er einmal voll ist.
  delete from public.uebertrag_code u
  using public.spieler s
  where u.spieler = s.id
    and s.aktualisiert < now() - interval '1 year';

  select spieler into inhaber from public.uebertrag_code where code = sauber;

  if inhaber is not null and inhaber <> p_spieler then
    raise exception 'Dieser Code ist schon vergeben.';
  end if;

  -- Der Spieler hatte vielleicht schon einen anderen Code — der wird frei.
  delete from public.uebertrag_code where spieler = p_spieler and code <> sauber;

  insert into public.uebertrag_code (code, spieler)
  values (sauber, p_spieler)
  on conflict (code) do nothing;

  /* NACHSEHEN, WEM DER CODE JETZT WIRKLICH GEHÖRT.
   *
   * Zwischen der Prüfung oben und diesem Einfügen können Millisekunden
   * liegen, und in denen kann sich jemand anders denselben Code holen. Das
   * `on conflict do nothing` schluckt den Zusammenstoss stillschweigend —
   * ohne diese zweite Abfrage bekämen BEIDE Spieler "hat geklappt" zu
   * hören, und einer von beiden liefe mit einem Code herum, der ihm nicht
   * gehört. Bei zehntausend Plätzen ist das kein Randfall. */
  select spieler into inhaber from public.uebertrag_code where code = sauber;
  if inhaber is distinct from p_spieler then
    raise exception 'Dieser Code ist schon vergeben.';
  end if;

  return sauber;
end;
$$;

revoke all on function public.code_belegen(uuid, text) from public;
grant execute on function public.code_belegen(uuid, text) to anon;


-- ---------------------------------------------------------------- vorschlag --
/* Holt einen freien Code UND belegt ihn sofort.
 *
 * VORSCHLAGEN ALLEIN REICHT NICHT. Die erste Fassung suchte nur einen freien
 * Code und gab ihn zurück; belegt wurde er erst, wenn der Spieler danach auf
 * "Merken" tippte. Dazwischen liegen Sekunden, in denen ihn jemand anders
 * nehmen kann — der Spieler bekäme unmittelbar nach "ist frei" ein "schon
 * vergeben" zu lesen und würde zu Recht denken, der Knopf sei kaputt. Bei
 * zehntausend Plätzen ist das kein theoretischer Randfall.
 *
 * Deshalb passiert beides in einem Zug. Das Einfügen selbst entscheidet, ob
 * der Code frei war: der Primärschlüssel lässt keinen zweiten zu. Die
 * Ausnahmebehandlung sitzt in einem eigenen Block, damit ein Zusammenstoss
 * nur diesen einen Versuch verwirft und nicht die ganze Transaktion.
 */
drop function if exists public.code_vorschlag();

create or replace function public.code_vorschlag(p_spieler uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  max_versuche constant int := 40;
  kandidat text;
  vorhanden text;
  i int;
begin
  -- Wer schon einen hat, bekommt denselben zurück. Ein zweiter Code wäre
  -- nicht nur unnötig, er ist wegen `spieler unique` gar nicht möglich.
  select code into vorhanden from public.uebertrag_code where spieler = p_spieler;
  if found then
    return vorhanden;
  end if;

  for i in 1..max_versuche loop
    kandidat := lpad((floor(random() * 10000))::int::text, 4, '0');
    begin
      insert into public.uebertrag_code (code, spieler) values (kandidat, p_spieler);
      return kandidat;
    exception when unique_violation then
      -- Schon weg. Nur dieser Versuch ist verloren, der nächste läuft weiter.
    end;
  end loop;

  -- 40 Fehlgriffe hintereinander heissen: der Vorrat ist so gut wie voll.
  raise exception 'Es sind fast alle Codes vergeben.';
end;
$$;

revoke all on function public.code_vorschlag(uuid) from public;
grant execute on function public.code_vorschlag(uuid) to anon;


-- ---------------------------------------------------------------- auflösen --
/* Gibt die Kennung zu einem Code zurück. Das ist die Tür, an der gerüttelt
 * wird — hier sitzt die Bremse.
 *
 * DIESE FUNKTION WIRFT NICHT, UND DAS IST DER GANZE PUNKT.
 *
 * Die erste Fassung zählte den Fehlversuch und warf danach
 * `raise exception 'Zu diesem Code ist nichts gespeichert'`. Ein raise dreht
 * aber die GANZE Transaktion zurück — mitsamt der Zeile, die gerade in
 * code_versuch geschrieben wurde. Der Zähler wäre für immer auf null
 * geblieben, die Bremse hätte nie gegriffen, und sie ist bei vier Ziffern
 * die einzige Verteidigung, die es überhaupt gibt. Der Fehler wäre im
 * Betrieb nicht aufgefallen: von aussen sieht eine wirkungslose Bremse
 * genauso aus wie eine wirksame, solange niemand angreift.
 *
 * Deshalb meldet der erwartete Fehlschlag über den RÜCKGABEWERT statt über
 * eine Ausnahme. Dieselbe Überlegung steht bei `eintragen` weiter oben — dort
 * ist das Zurückdrehen erwünscht (die Marke soll Fehlversuche überleben),
 * hier ist es genau verkehrt herum.
 */
drop function if exists public.code_aufloesen(text);

create or replace function public.code_aufloesen(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Grenze als benannte Konstante, wie bei den übrigen Bremsen der Datei.
  max_fehlversuche constant int := 10;
  sauber text := btrim(coalesce(p_code, ''));
  gefunden uuid;
begin
  if sauber !~ '^[0-9]{4}$' then
    return json_build_object('ok', false, 'grund', 'form');
  end if;

  -- Alte Versuche wegräumen, damit die Tabelle nicht wächst.
  delete from public.code_versuch where zeitpunkt < now() - interval '1 day';

  if (
    select count(*) from public.code_versuch
    where treffer = false and zeitpunkt > now() - interval '1 minute'
  ) >= max_fehlversuche then
    -- Hier BEWUSST nichts mitzählen: sonst hielte die Bremse sich selbst am
    -- Leben, und ein einziger Ausrutscher sperrte dauerhaft.
    return json_build_object('ok', false, 'grund', 'gebremst');
  end if;

  select spieler into gefunden from public.uebertrag_code where code = sauber;

  insert into public.code_versuch (treffer) values (gefunden is not null);

  if gefunden is null then
    -- Ohne Hinweis darauf, ob es den Code gibt. Alles andere wäre eine
    -- Auskunftsstelle darüber, welche Codes vergeben sind.
    return json_build_object('ok', false, 'grund', 'unbekannt');
  end if;

  update public.uebertrag_code set benutzt = now() where code = sauber;
  return json_build_object('ok', true, 'kennung', gefunden);
end;
$$;

revoke all on function public.code_aufloesen(text) from public;
grant execute on function public.code_aufloesen(text) to anon;


-- ============================================================================
--  Aufräumen (optional)
--
--  Mit "ein Eintrag je Name" wächst die Tabelle deutlich langsamer als
--  vorher. Wer trotzdem knapp halten will, richtet das als geplante Aufgabe
--  (pg_cron) einmal täglich ein:
-- ============================================================================

-- delete from public.bestenliste
-- where id not in (
--   select id from public.bestenliste order by score desc limit 1000
-- );
