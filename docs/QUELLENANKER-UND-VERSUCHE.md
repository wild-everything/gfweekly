# Quellenanker und fehlgeschlagene Versuche

Ausgang: Hauptstand `05eef263caa470c7f3aa5b4e14be86e822473810`, geprüft am 02.11.2026. Das veröffentlichte `lauf.ts` entsprach diesem Stand. Diese Änderung ist für eine getrennte Entwicklungsarbeitskopie vorbereitet; die Dokumentation behauptet keine Veröffentlichung.

## Geändertes Verhalten

- Numerische Datumsangaben und Eurobeträge im Beleg müssen in Betreff, Absender oder Text der Quelle vorkommen. Sämtliche erkannten Angaben werden geprüft. Ein richtiger Name verdeckt keinen erfundenen Betrag. Gleichwertige Schreibweisen werden vereinheitlicht, etwa `24.10.26`/`2026-10-24` und `1.200,50 Euro`/`1200.50 EUR`. Ungültige Datumswerte werden abgelehnt. Ohne konkrete Verankerung wird eine sonst mögliche Live-Erledigung wie bisher zum Vorschlag.
- Die Duplikatprüfung berücksichtigt die genaue Nachricht. Eine neue Nachricht in einem bereits geprüften Gmail-Thread bleibt prüfbar.
- `hh_lauf_versuche` reserviert Quellen atomar und speichert ausschließlich Kennungen, Zeit und SHA-256, keine Betreffzeile oder Mailtexte. Ein Quellen-/Moduspaar kann nur einmal gleichzeitig reserviert sein, auch bei zwei Postfächern.
- Vor einer fachlichen Schreibaktion einschließlich Tagesdeckel-Reservierung wechselt der Versuch in die Phase `schreiben`. Fehler in der Analyse sind höchstens dreimal insgesamt, frühestens nach 15 Minuten wiederholbar. Eine Reservierung läuft nach zehn Minuten ab; ein alter Token kann dann keine Schreibfreigabe mehr erhalten.
- Die Wiederholungsabfrage regulärer Ticks ist unabhängig vom Gmail-Cursor. Explizite Zeitfenster mit `after` oder `before` ziehen keine davon unabhängigen Wiederholungsaufträge hinein. Wiederholungen lesen die ursprünglich reservierte Nachricht mit höchstens deren drei letzten Kontextnachrichten oder genau den damaligen Feed-Eintrag. Eine spätere Nachricht wird nicht in einen alten Versuch eingeschoben. Veränderte oder fehlende Quellen werden nicht ausgewertet und verbrauchen einen der begrenzten Versuche.
- Fehler oder abgelaufene Reservierungen nach Schreibbeginn erhalten `wirkung_offen`. Sie werden nicht automatisch wiederholt. Auch verlorene Antworten auf bereits bestätigte Schreibaktionen lösen keine zweite Aktion aus. `erschoepft` und `wirkung_offen` bleiben über die Einstellungen-API (`versuche`) und `letzter_fehler` sichtbar.
- Das Protokoll hält jeden neuen Versuch gesondert fest (`versuch` 1–3); bestehende Einträge und Probeläufe erhalten 0. Kennungen der eigentlichen fachlichen Schreibaktionen bleiben gleich. Auswertungen des Protokolls zählen dadurch Prüfversuche, einschließlich früherer Fehler.

## Schutzregeln und Grenzen

`aus`, der Probelauf mit ausschließlich Protokollschreiben, die Postfach-Auswahlliste, die Beschränkung von Nutzlast-Mails auf Vorhaben mit `(Test)`, das Einwurf-Verbot für Fixtures, Vertraulichkeitsfilter, Sicherheitsschwellen, Kandidatenregeln, Tagesdeckel, atomare Erledigung mit Beleg, Rücknahme-Sperre und Selbstabschaltung bleiben bestehen. Interne Wiederholungsmarkierungen werden aus Nutzlast-Mails entfernt. Fixtures werden nicht automatisch wiederaufgenommen.

Alte Fehlerprotokolle haben keine verlässliche Angabe zur damaligen Schreibphase und werden konservativ zur Klärung gestellt. Vorherige erfolgreiche oder anderweitig bereits protokollierte Quellen bleiben gesperrt. `gedeckelt` bleibt ein eigener abgeschlossener Zustand; die Änderung führt keine Wiedervorlage am Folgetag ein. Es entsteht kein neuer Zeitplan und keine zusätzliche Modellanbindung. Bereits laufende Anfragen und eine währenddessen geänderte Einstellung werden durch die zusätzlichen Datenbankprüfungen begrenzt; die bestehende fachliche Schreib-RPC bleibt erhalten.

Der Quellenanker ist eine mechanische Plausibilitätsprüfung für die unterstützten numerischen Datums- und Euro-Schreibweisen. Er beweist weder den fachlichen Abschluss noch die Zuordnung eines Betrags zu einer Handlung. Die bestehende Wortprüfung ohne Zahlen bleibt heuristisch. Keine Aussage über alle Datums-/Währungsformate oder fachliche Fehlerfreiheit. Dafür bleiben Moduswahl, menschliche Sichtung, Rücknahme und Bilanz erforderlich.

## Prüfung

`pruefung/lauf-sicherheit.test.mjs` lädt die tatsächlichen SQL-Funktionen in PGlite und verbindet `laufModul` über eine kleine PostgREST-Fassade mit derselben Datenbank. Gmail und Modellantworten sind synthetisch. Netzwerkfehler vor der Analyse und verlorene Antworten nach einem tatsächlich ausgeführten Schreib-RPC werden gezielt eingestreut. Geprüft werden Quellenanker, Reservierung, Wartezeit, Höchstzahl, abgelaufene Tokens, Moduswechsel, Rechte/RLS, Altfälle, Cursorfortschritt, genaue Nachrichten-/Feed-Fassung, unklarer Schreibausgang, Probelauf, Fixtures, Vertraulichkeit, Deckel, atomarer Rollback und Rücknahme-Sperre.

```sh
# Node >= 22.18 mit Type-Stripping, PGlite 0.5.14 in einem getrennten Testordner
PGLITE_MODUL=file:///absoluter/testordner/node_modules/@electric-sql/pglite/dist/index.js \
  node --experimental-strip-types --test pruefung/lauf-sicherheit.test.mjs
```

CI und `pruefung/abnahme.sh` führen die Prüfung mit aus. Der bestehende Rechentest in `stufe3-probe.mjs` erwartet die Ablehnung erfundener Anker. Dessen optionaler Produktions-Wirkungsteil ist hiervon getrennt und wird nicht automatisch gestartet. Die lokale SQL-Engine serialisiert Verbindungen; die konkurrierende Reservierungsprobe ersetzt keinen Lasttest mit mehreren echten PostgreSQL-Verbindungen. Deployment, produktive Migration und reale Gmail-/Modellaufrufe sind keine Ergebnisse der isolierten Tests.

## Einspielung und Rückweg

Vor einer späteren Freigabe den dann aktuellen Stand erneut abgleichen. Für die Einspielung den Lauf kontrolliert anhalten, laufende Ticks auslaufen lassen, Migration `20261102103454_lauf_quellenanker_versuche.sql` anwenden und erst danach die dazugehörige Edge Function veröffentlichen. Die Migration selbst ändert weder Modus noch Zeitplan. Anschließend kontrolliert im Probelauf beginnen. Die Kombination aus altem und neuem ausführendem Code parallel ist zu vermeiden.

Vor einem Rückweg ebenfalls anhalten und laufende Ticks auslaufen lassen. Zunächst die neuen Versuchsdaten und Protokolle sichern. Der alte Code versteht die neue Versuchsnummer nicht: Vor Rückkehr zum alten Protokollschlüssel pro Quelle/Punkt/Modus einen repräsentativen Eintrag behalten (ausgeführt vor nicht ausgeführt, dann neuester Eintrag), die übrigen in der Sicherung erhalten. Erst danach den generierten `schluessel` auf den Ausdruck aus Migration `20261026130000_stufe3_runde1.sql` zurücksetzen und `versuch` entfernen. Die vier neuen Versuchsfunktionen vor `hh_lauf_versuche` entfernen. Dieses Dokument ist keine Aufforderung zu Löschung oder Produktions-Rollback.
