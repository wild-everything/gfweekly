#!/bin/zsh
# Abnahme des Kompasses: Tokens, Farben, Kontrast, Matrix, Schirme, Bedienung. Bricht beim ersten Fehler ab.
# Aufruf aus dem Repo: PLAYWRIGHT_MODUL=<pfad>/node_modules/playwright/index.mjs TS_BASIS=file://<pfad>/typescript.js PGLITE_MODUL=<pfad>/node_modules/@electric-sql/pglite/dist/index.js DENO_BIN=<pfad>/deno ./pruefung/abnahme.sh [zielordner]
set -e
set -o pipefail
cd "$(dirname "$0")/.."
ZIEL=${1:-/tmp/hh-schirme}

echo "== Tokens gegen die Quelle =="
python3 pruefung/tokens.py

echo "\n== Farbscan (Türkis in site/assets) =="
FUNDE=$(python3 pruefung/farbscan.py site/assets)
if [ -n "$FUNDE" ]; then echo "$FUNDE"; echo "Farbscan: Funde vorhanden"; exit 1; fi
echo "null Funde"

echo "\n== Kontrast beider Themen =="
# Keine Pipeline: sie wuerde den Fehlerstatus von kontrast.py verschlucken.
if ! KONTRAST=$(python3 pruefung/kontrast.py); then
  echo "$KONTRAST" | grep FEHLT || true
  echo "Kontrast: Paare unter der Schwelle"; exit 1
fi
echo "$KONTRAST" | tail -1

echo "\n== Matrix (reine Funktion, ohne Edge Function) =="
node pruefung/matrix-test.mjs | tail -1

echo "\n== Schirme (20 Seiten, 25 Ansichten, 1440 und 390, dunkel und hell) =="
node pruefung/schirme.mjs "$ZIEL"

echo "\n== Bedienung (Vertretung, Vorhaben) =="
node pruefung/bedienung.mjs | tail -1

echo "\n== Webapp Standard, Pilot zur Erprobung: 320 px, 200 % Text, Schrift, Ziele, Namen, Tastatur, Bewegung, Dialoge, Bedienproben =="
node pruefung/webstandard-pruefung.mjs | tail -2

echo "\n== Organisationsentscheidungen =="
node pruefung/organisation-entscheidungsfuehrung.mjs

echo "\n== Kommunikation (V32): Rechenlogik, Vergleich mit dem Python-Rechner, Bedienung =="
node pruefung/komm-test.mjs | tail -1
node pruefung/komm-vergleich.mjs
node pruefung/komm-bedienung.mjs | tail -1
if [ -n "$PGLITE_MODUL" ]; then node pruefung/organisation-db-probe.mjs; node pruefung/komm-sql-probe.mjs | tail -1; ${DENO_BIN:-deno} run -A pruefung/komm-aktionen-probe.ts | tail -1; else echo "SQL- und Aktionsprobe übersprungen (PGLITE_MODUL nicht gesetzt)"; fi

echo "\n== Verkauf 2027: Rechenregeln und Eingaben (ohne Backend; Wirkung mit GF_PW) =="
node pruefung/verkauf-probe.mjs | tail -1

echo "\n== Stufe 1: Entscheidungen (Rechenregeln und Eingaben; Wirkung mit GF_PW) =="
node pruefung/entscheidungen-probe.mjs | tail -1

echo "\n== Stufe 2: ein Behälter (Rechenregeln, Navigation; Wirkung mit GF_PW) =="
node pruefung/stufe2-probe.mjs | tail -1

echo "\n== Lauf: Quellenanker und Fehlerversuche (isoliertes PostgreSQL, keine Produktionswirkung) =="
node --experimental-strip-types --test pruefung/lauf-sicherheit.test.mjs

echo "\n== Wächter (statische Prüfungen) =="
WAECHTER_OHNE_FRISCHE=1 node pruefung/waechter.mjs

echo "\nAlle Prüfungen bestanden."
echo "Hinweis: Schirme und Bedienung sind Oberflächentests, sie fangen die Edge Function ab."
echo "Sie belegen Aufbau, Kontrast, Überlauf und Bedienwege, nicht die Wirkung in der Datenbank."
# Beleg schreiben, damit „fertig“ nicht ohne frische Prüfung behauptet werden kann.
# Der Beleg haengt am Inhalt der geprueften Dateien, nicht am Commit: sonst waere er nach dem
# naechsten Commit veraltet, obwohl sich nichts Geprueftes geaendert hat.
STAND=$(pruefung/stand.sh)
cat > pruefung/letzte-abnahme.json <<JSON
{
  "stand": "$STAND",
  "commit": "$(git rev-parse HEAD)",
  "datum": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "laeufe": ["tokens", "farbscan", "kontrast", "matrix", "schirme (Oberfläche)", "bedienung (Oberfläche)", "kommunikation", "organisationsentscheidungen", "webstandard (Oberfläche)", "verkauf (Rechenregeln)", "entscheidungen (Rechenregeln)", "stufe 2 (Rechenregeln, Navigation)", "Lauf (isoliertes PostgreSQL)", "waechter"],
  "ungeprueft": "Wirkung in der Datenbank, Asana-Lebenszyklus, Nebenläufigkeit, verborgene Oberflächenteile"
}
JSON
echo "Beleg geschrieben: pruefung/letzte-abnahme.json"

echo "\n== Wächter, vollständig (mit Frischeprüfung) =="
node pruefung/waechter.mjs
