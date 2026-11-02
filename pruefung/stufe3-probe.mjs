/* Stufe 3 · Lauf im Kompass, weniger Seiten, Ruhe halten (26.10.2026, docs/PAKET-STUFE-3-LAUF-IM-KOMPASS.md, Abschnitt 6.2). Zwei Teile:
   1. Rechenregeln (immer): Einstufung und Aktion des Laufs (laufStufe, laufAktion), Navigation mit 14 Einträgen in drei Gruppen, Reiter.
   2. Wirkung gegen das echte Backend (nur mit GF_PW): Einstellungen (nur Alex oder Lea, Protokollzeile), Probelauf mit Fixtures
      (sicher, unklar, gesendete Mail, Einwurf-Adresse), Modus live auf einem Testvorhaben: der Lauf erledigt den Testpunkt mit Beleg,
      Rückgängig aus der Akte, ein zweites Erledigen desselben Punkts wird gesperrt; Selbstabschaltung mit gefälschter Bilanz;
      Google-Probe ohne Secret (sauberer Fehler); danach Modus zurück auf den Ausgangswert und aufräumen.
   Aufruf: node pruefung/stufe3-probe.mjs
           GF_PW=… node pruefung/stufe3-probe.mjs   (Passwort aus dem Vault, nie ausgeben; siehe docs/TECHNIKSTAND.md) */
import { laufStufe, laufAktion, istEinwurfMail, mailText, belegVerankert, abschaltungFaellig } from '../supabase/functions/gfweekly/lauf.ts';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let ok = 0, fehler = 0;
const pruefe = (name, b, info = '') => { if (b) { ok++; console.log('  ok     ' + name); } else { fehler++; console.log('  FEHLT  ' + name + (info ? ' · ' + String(info).slice(0, 300) : '')); } };

console.log('== Stufe 3: Rechenregeln ==');
pruefe('sicher nur mit Punkt, Sicherheit ab 0,8 und belegtem Abschluss; wahrscheinlich ab 0,7; sonst unklar',
  laufStufe({ sicherheit: 0.9, abschluss_belegt: true }, true, true) === 'sicher' && laufStufe({ sicherheit: 0.9, abschluss_belegt: false }, true, true) === 'wahrscheinlich'
  && laufStufe({ sicherheit: 0.9, abschluss_belegt: true }, false, true) === 'wahrscheinlich' && laufStufe({ sicherheit: 0.65, abschluss_belegt: true }, true, true) === 'unklar' && laufStufe({ sicherheit: 0.95 }, false, false) === 'unklar');
pruefe('Aktion: live erledigt, vorschlag und probe schlagen vor, gesperrter Punkt wird nicht erledigt, Kandidat nie aus gesendeter Mail',
  laufAktion('sicher', 'live', true, false, false, false) === 'erledigt' && laufAktion('sicher', 'vorschlag', true, false, false, false) === 'vorschlag' && laufAktion('sicher', 'probe', true, false, false, false) === 'vorschlag'
  && laufAktion('sicher', 'live', true, false, false, true) === 'gesperrt' && laufAktion('wahrscheinlich', 'live', false, true, true, false) === 'nichts' && laufAktion('wahrscheinlich', 'live', false, true, false, false) === 'kandidat' && laufAktion('unklar', 'live', false, false, false, false) === 'nichts' && laufAktion('unklar', 'live', false, true, false, false) === 'nichts');
pruefe('Beleg nur verankert mit Datum, Betrag oder kennzeichnendem Wort aus der Quelle; allgemeine Sätze nicht', belegVerankert('Die Nordlicht GmbH bestätigt den Eingang des Probevertrags.', { betreff: 'Re: Probevertrag Nordlicht GmbH', text: 'ist eingegangen' }) && !belegVerankert('Zahlung von 1.200 Euro am 24.10.2026 bestätigt.', { betreff: 'x', text: 'y' }) && belegVerankert('Zahlung von 1.200 Euro am 24.10.2026 bestätigt.', { text: 'Am 2026-10-24 gingen 1200 EUR ein.' }) && !belegVerankert('Die Angelegenheit ist nun erledigt und abgeschlossen.', { betreff: 'Re: Probevertrag Nordlicht GmbH', text: 'ist eingegangen' }) && !belegVerankert('Erledigt.', { betreff: 'Nordlicht', text: '' }));
pruefe('Selbstabschaltung: fünf Fälle über zwei Wochen, jede Woche unter 50 %', abschaltungFaellig({ erledigt: 3, zurueck: 2 }, { erledigt: 2, zurueck: 2 }) && !abschaltungFaellig({ erledigt: 3, zurueck: 2 }, { erledigt: 1, zurueck: 0 }) && !abschaltungFaellig({ erledigt: 4, zurueck: 3 }, { erledigt: 0, zurueck: 0 }));
pruefe('Einwurf-Adressen bleiben beim Einwurf-Weg; Mailtext trägt Kopfzeilen und ist begrenzt', istEinwurfMail({ an: 'Lea <lea+einwurf@wildemoehre.org>' }) && !istEinwurfMail({ an: 'lea@wildemoehre.org' }) && /^Von: a\nAn: b\nDatum: c\nBetreff: d\n/.test(mailText({ von: 'a', an: 'b', datum: 'c', betreff: 'd', text: 'x'.repeat(5000) })) && mailText({ text: 'x'.repeat(5000) }).length <= 3500);
{
  const core = fs.readFileSync(new URL('../site/assets/core.js', import.meta.url), 'utf8');
  const navBlock = core.slice(core.indexOf('const GF_NAV=['), core.indexOf('];', core.indexOf('const GF_NAV=[')));
  const nav = [...navBlock.matchAll(/\["([a-z]+)","[a-z.-]+\.html","/g)].map(m => m[1]);
  pruefe('Navigation: 14 Einträge, drei Gruppen, Einstellungen statt Wichtige Seiten und Bearbeiten, Vertretung statt Übergabe und Rückkehr, kein Jahr', nav.length === 14 && (navBlock.match(/\["(Heute|Arbeiten|Verwalten)",\[/g) || []).length === 3 && nav.includes('einstellungen') && nav.includes('vertretung') && !nav.includes('jahr') && !nav.includes('uebergabe') && !nav.includes('seiten') && !nav.includes('edit'), nav.join(','));
  pruefe('Reiter: Vertretung (3), Saison (2), Einstellungen (3); Aliasse markieren die Gruppe', /vertretung:\[\["vertretung"[^\]]*\],\["uebergabe"[^\]]*\],\["rueckkehr"/.test(core) && /saison:\[\["saison"[^\]]*\],\["jahr"/.test(core) && /einstellungen:\[\["einstellungen"[^\]]*\],\["edit"[^\]]*\],\["seiten"/.test(core) && /GF_NAV_ALIAS=\{[^}]*uebergabe:"vertretung"[^}]*jahr:"saison"[^}]*edit:"einstellungen"/.test(core));
  pruefe('Alle Seiten tragen ?v=43', fs.readdirSync(new URL('../site/', import.meta.url)).filter(f => f.endsWith('.html')).every(f => /\?v=43/.test(fs.readFileSync(new URL('../site/' + f, import.meta.url), 'utf8'))));
}

/* ---- Teil 2: Wirkung gegen das echte Backend ---- */
const PW = process.env.GF_PW || '';
if (!PW) { console.log('\nWirkung gegen das echte Backend übersprungen (GF_PW nicht gesetzt).'); }
else {
  console.log('\n== Stufe 3: Wirkung gegen das echte Backend (Einstellungen, Probelauf, Live auf Testvorhaben, Selbstabschaltung) ==');
  const URL_FN = 'https://bnfmupnmqyrcltrphfak.supabase.co/functions/v1/gfweekly';
  const api = async (action, payload) => { const r = await fetch(URL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, password: PW, payload }) }); let d = null; try { d = await r.json(); } catch { d = null; } return { status: r.status, d }; };
  const M = 'Stufe 3 Probe (Test)';
  const K = { vorhaben: null, punkt: null, modusVorher: null, run: 'probe-s3-' + Date.now(), start: new Date().toISOString() };
  const sql = (text) => {
    const leer = fs.mkdtempSync(path.join(os.tmpdir(), 's3-probe-')); const f = path.join(leer, 'q.sql'); fs.writeFileSync(f, text);
    const r = spawnSync('npx', ['--yes', 'supabase', 'db', 'query', '--linked', '--project-ref', 'bnfmupnmqyrcltrphfak', '-f', f], { cwd: leer, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (r.status !== 0) return { fehler: ((r.stdout || '') + ' ' + (r.stderr || '')).replace(/\s+/g, ' ').slice(0, 600) };
    try { const s = r.stdout; return JSON.parse(s.slice(s.indexOf('{'))); } catch (e) { return { fehler: 'keine JSON-Antwort' }; }
  };
  const aufraeumen = () => {
    const t = [];
    t.push(`delete from public.hh_lauf_versuche where quelle_ref like 'mail:s3fix%' and quelle->>'fixture' = 'true';`);
    t.push(`delete from public.hh_lauf_protokoll where run_id like '${K.run}%' or (run_id like 'abschaltung:%' and created_at >= '${K.start}');`);
    t.push(`delete from public.gfweekly_news where source_ref like 'lauf:abschaltung:%' and created_at >= '${K.start}';`);
    if (K.punkt) t.push(`delete from public.hh_entscheidungen where quelle_id = '${K.punkt}';`);
    if (K.vorhaben) { t.push(`delete from public.hh_vorhaben_verlauf where vorhaben_id = '${K.vorhaben}';`); t.push(`delete from public.hh_vorhaben_punkte where vorhaben_id = '${K.vorhaben}';`); t.push(`delete from public.hh_vorhaben where id = '${K.vorhaben}' and title like '%(Test)%';`); }
    t.push(`delete from public.gfweekly_news where source_ref like 'mail:s3fix%' or source_ref like 'lauf:tag:%' and body like '%fixtures%';`);
    if (K.modusVorher) t.push(`update public.hh_lauf_einstellungen set modus = '${K.modusVorher}', abbruch_grund = null where id = 1;`);
    if (K.tagVorher !== undefined) t.push(`insert into public.hh_lauf_tag (tag, sichtung) values (current_date, ${K.tagVorher}) on conflict (tag) do update set sichtung = ${K.tagVorher};`);
    t.push(`select (select count(*) from public.hh_vorhaben where id ${K.vorhaben ? `= '${K.vorhaben}'` : 'is null'}) as vh, (select count(*) from public.hh_lauf_protokoll where run_id like '${K.run}%' or (run_id like 'abschaltung:%' and created_at >= '${K.start}')) as prot, (select count(*) from public.gfweekly_news where (source_ref like 'mail:s3fix%' or source_ref like 'lauf:abschaltung:%') and created_at >= '${K.start}') as news, (select modus from public.hh_lauf_einstellungen where id = 1) as modus, (select coalesce((select sichtung from public.hh_lauf_tag where tag = current_date), 0)) as tag;`);
    return sql(t.join('\n'));
  };
  const fix = (id, o) => ({ thread_id: 's3fix-' + id, message_id: 's3fix-' + id + '-m', von: o.von || 'partner@example.org', an: o.an || 'alex@wildemoehre.org', betreff: o.betreff, datum: o.datum || new Date().toISOString(), text: o.text, gesendet: !!o.gesendet });
  try {
    const ping = await api('ping', {});
    pruefe('Edge Function mit Stufe 3 (ping version ≥ 43, gmailConfigured gemeldet)', ping.status === 200 && ping.d.version >= 43 && typeof ping.d.gmailConfigured === 'boolean', JSON.stringify(ping.d));
    const e0 = await api('lauf_einstellungen_get', {});
    K.modusVorher = e0.d?.einstellungen?.modus || 'aus';
    K.tagVorher = Number(sql(`select coalesce((select sichtung from public.hh_lauf_tag where tag = current_date), 0) as n;`).rows?.[0]?.n ?? 0);
    pruefe('Einstellungen lesen: Modus, Zeitplan hh_lauf_tick, vier Kriterien, Wochen, Protokoll', e0.status === 200 && ['aus','probe','vorschlag','live'].includes(K.modusVorher) && (e0.d.cron || []).some(c => String(c.jobname).startsWith('hh_lauf_tick') && c.active) && (e0.d.kriterien || []).length === 4 && Array.isArray(e0.d.wochen) && Array.isArray(e0.d.letzte), JSON.stringify(e0.d).slice(0, 200));
    const s1 = await api('lauf_einstellungen_set', { modus: 'probe', by: 'Helge' });
    const s2 = await api('lauf_einstellungen_set', { modus: 'irgendwas', by: 'Alex' });
    const s3 = await api('lauf_einstellungen_set', { by: 'Alex' });
    pruefe('Einstellungen ändern: fremde Person 400, falscher Modus 400, nichts zu ändern 400', s1.status === 400 && s2.status === 400 && s3.status === 400, [s1.status, s2.status, s3.status].join(','));
    const gpX = await api('lauf_gmail_probe', { postfach: 'fremd@example.org' });
    pruefe('Fremdes Postfach wird abgelehnt (400), auch im Tick', gpX.status === 400 && (await api('lauf_tick', { probe: true, postfach: 'fremd@example.org', mails: [] })).status === 400, JSON.stringify(gpX.d));
    const gp = await api('lauf_gmail_probe', { postfach: 'alex@wildemoehre.org' });
    pruefe('Google-Probe: ohne Secret ein benannter Fehler (503), mit Secret eine Zahl', (gp.status === 503 && /GOOGLE_SA_JSON/.test(gp.d?.error || '')) || (gp.status === 200 && typeof gp.d.threads_24h === 'number'), JSON.stringify(gp.d));
    /* Testvorhaben und Punkt */
    const vh = await api('vorhaben_save', { title: M + ' Vorhaben', by: 'Alex', gruppe: 'sonstiges', ball: 'gf' });
    K.vorhaben = vh.d?.vorhaben?.id || null; const slug = vh.d?.vorhaben?.slug;
    const pk = await api('punkt_save', { vorhaben_id: K.vorhaben, titel: 'Probevertrag Nordlicht GmbH unterschrieben zurückschicken (Test)', wer: 'GF gemeinsam', by: 'Alex' });
    K.punkt = pk.d?.punkt?.id || null;
    pruefe('Testvorhaben mit Testpunkt (wer GF gemeinsam) angelegt', !!K.vorhaben && !!K.punkt, JSON.stringify([vh.d, pk.d]).slice(0, 200));
    const mails = [
      fix('sicher', { von: 'buero@nordlicht-gmbh.example', betreff: 'Re: Probevertrag Nordlicht GmbH', text: `Hallo Alex, vielen Dank, der von euch unterschriebene Probevertrag Nordlicht GmbH ist heute bei uns eingegangen, damit ist alles komplett. Viele Grüße Nordlicht GmbH` }),
      fix('unklar', { von: 'news@irgendwas.example', betreff: 'Unser Oktober-Newsletter', text: 'Drei Tipps für die dunkle Jahreszeit. Jetzt lesen.' }),
      fix('gesendet', { von: 'alex@wildemoehre.org', an: 'buero@nordlicht-gmbh.example', betreff: 'Probevertrag Nordlicht GmbH', text: 'Hallo, anbei der unterschriebene Probevertrag Nordlicht GmbH. Viele Grüße Alex', gesendet: true }),
      fix('einwurf', { von: 'alex@wildemoehre.org', an: 'alex+einwurf@wildemoehre.org', betreff: 'Notiz', text: 'Victor hat zugesagt.' }),
    ];
    const t0 = K.modusVorher === 'aus' ? await api('lauf_tick', { run_id: K.run + '-0', postfach: 'alex@wildemoehre.org', mails }) : { status: 200, d: { uebersprungen: true } };
    pruefe('Modus aus schreibt nichts, auch nicht mit Nutzlast (Runde 1, Befund 1)', t0.status === 200 && t0.d.uebersprungen === true, JSON.stringify(t0.d).slice(0, 200));
    const t1 = await api('lauf_tick', { probe: true, run_id: K.run + '-a', postfach: 'alex@wildemoehre.org', mails });
    const z = (ref) => (t1.d?.zeilen || []).find(x => x.ref.includes(ref));
    pruefe('Probelauf: der Beleg zum Testpunkt ist sicher, der Newsletter unklar, die Einwurf-Mail übersprungen, nichts ausgeführt', t1.status === 200 && t1.d.modus === 'probe' && z('s3fix-sicher')?.stufe === 'sicher' && z('s3fix-sicher')?.punkt === K.punkt && z('s3fix-sicher')?.aktion === 'vorschlag' && z('s3fix-unklar')?.stufe === 'unklar' && z('s3fix-einwurf')?.aktion === 'uebersprungen' && t1.d.zusammen.erledigt === 0, JSON.stringify(t1.d?.zeilen).slice(0, 500));
    const pq = sql(`select erledigt from public.hh_vorhaben_punkte where id = '${K.punkt}'; select count(*) as n from public.hh_lauf_protokoll where run_id = '${K.run}-a';`);
    pruefe('Probelauf schreibt nur Protokoll (vier Zeilen), der Punkt bleibt offen', Number(pq.rows?.[0]?.n) === 4, JSON.stringify(pq).slice(0, 200));
    const t1b = await api('lauf_tick', { probe: true, run_id: K.run + '-a2', postfach: 'alex@wildemoehre.org', mails });
    pruefe('Derselbe Lauf noch einmal: alle Mails übersprungen (Protokoll dedupliziert)', t1b.status === 200 && t1b.d.zusammen.uebersprungen === 4 && t1b.d.zusammen.geprueft === 0, JSON.stringify(t1b.d?.zusammen));
    /* Live auf dem Testvorhaben */
    const sl = await api('lauf_einstellungen_set', { modus: 'live', by: 'Lea' });
    const t2 = await api('lauf_tick', { run_id: K.run + '-b', postfach: 'alex@wildemoehre.org', mails: [mails[0]] });   // dieselbe Mail wie im Probelauf: der Probelauf sperrt sie nicht (Runde 1, Befund 4)
    const lq = sql(`select p.erledigt, p.erledigt_by, (select count(*) from public.hh_vorhaben_verlauf v where v.punkt_id = p.id and v.created_by = 'lauf' and v.status = 'bestaetigt') as lauf_eintraege, (select source_url from public.hh_vorhaben_verlauf v where v.punkt_id = p.id and v.created_by = 'lauf' and v.art = 'mail' limit 1) as url from public.hh_vorhaben_punkte p where p.id = '${K.punkt}';`);
    pruefe('Live: der Lauf erledigt den Testpunkt (erledigt_by lauf) mit Beleg-Eintrag (zwei Lauf-Einträge, keine Gmail-Adresse bei Fixtures)', sl.status === 200 && t2.status === 200 && t2.d.zusammen.erledigt === 1 && lq.rows?.[0]?.erledigt === true && lq.rows[0].erledigt_by === 'lauf' && Number(lq.rows[0].lauf_eintraege) === 2 && lq.rows[0].url === null, JSON.stringify([sl.d?.error, t2.d?.zeilen, lq.rows]).slice(0, 400));
    const lk = await api('entscheidungen_list', { status: 'alle' });
    const en = (lk.d?.eintraege || []).find(e => e.quelle_id === K.punkt);
    pruefe('Die Entscheidung zum Punkt ist hinfällig (erledigt durch den Lauf)', !en || en.status === 'hinfaellig', JSON.stringify(en || null).slice(0, 200));
    const vg = await api('vorhaben_get', { id: K.vorhaben });
    const eintrag = (vg.d?.verlauf || []).find(e => e.created_by === 'lauf' && e.art === 'system');
    const rg = eintrag ? await api('lauf_rueckgaengig', { id: eintrag.id, by: 'Alex' }) : { status: 0 };
    const rq = sql(`select erledigt from public.hh_vorhaben_punkte where id = '${K.punkt}';`);
    pruefe('Rückgängig aus der Akte: Punkt wieder offen, zwei Lauf-Einträge verworfen', rg.status === 200 && rg.d.verworfen === 2 && rq.rows?.[0]?.erledigt === false, JSON.stringify([!!eintrag, rg.d]).slice(0, 300));
    const tk = await api('lauf_tick', { run_id: K.run + '-k', postfach: 'alex@wildemoehre.org', mails: [fix('kandidat', { von: 'buero@nordlicht-gmbh.example', betreff: 'Nordlicht GmbH: Entscheidung zur Zusatzoption bis 05.11.', text: `Hallo Alex, zum Probevertrag Nordlicht GmbH (Test) bräuchten wir bis zum 05.11.2026 eure Entscheidung, ob ihr die Zusatzoption Winterlager für 1.200 Euro ziehen wollt. Viele Grüße Nordlicht GmbH` })] });
    const kq = sql(`select gate, gate_frist, vorhaben_vorschlag, relevance, source from public.gfweekly_news where source_ref = 'mail:s3fix-kandidat:s3fix-kandidat-m:k1';`);
    const zk = (tk.d?.zeilen || [])[0];
    pruefe('Kandidat aus einer Mail: ohne gate (keine Entscheidung ohne Punkt), mit Vorschlag auf das Vorhaben und Datum aus der Quelle; oder als Vorschlag im Verlauf, nie als Entscheidung', tk.status === 200 && zk && ['kandidat', 'vorschlag', 'nichts'].includes(zk.aktion) && (zk.aktion !== 'kandidat' || (kq.rows?.[0] && kq.rows[0].gate === null && kq.rows[0].vorhaben_vorschlag === K.vorhaben && kq.rows[0].source === 'mail')), JSON.stringify([zk, kq.rows]).slice(0, 400));
    const te = await api('lauf_tick', { run_id: K.run + '-e', postfach: 'alex@wildemoehre.org', mails: [mails[3]] });
    const eq2 = sql(`select count(*) as n from public.hh_einwurf where source_ref like 'mail:s3fix-einwurf%';`);
    pruefe('Einwurf-Mail aus der Nutzlast legt außerhalb des Probelaufs keinen Einwurf an (Runde 2, Befund 4)', te.status === 200 && (te.d.zeilen || [])[0]?.aktion === 'uebersprungen' && Number(eq2.rows?.[0]?.n) === 0, JSON.stringify([te.d?.zeilen, eq2.rows]).slice(0, 300));
    const t3 = await api('lauf_tick', { run_id: K.run + '-c', postfach: 'alex@wildemoehre.org', mails: [fix('sicher3', { von: 'buero@nordlicht-gmbh.example', betreff: 'Re: Probevertrag Nordlicht GmbH', text: 'Nochmals: der unterschriebene Probevertrag Nordlicht GmbH ist eingegangen, erledigt.' })] });
    const z3 = (t3.d?.zeilen || [])[0];
    pruefe('Ein zweites Erledigen desselben Punkts nach Rückgängig wird gesperrt', t3.status === 200 && z3 && z3.aktion === 'gesperrt' && t3.d.zusammen.erledigt === 0, JSON.stringify(z3));
    /* Selbstabschaltung: gefälschte Bilanz (5 Erledigungen, 3 Rücknahmen in 14 Tagen) */
    /* Zwei getrennte Wochen (Runde 1, Befund 10): je 4 Erledigungen und 3 Rücknahmen, diese Woche und vor 9 Tagen. */
    /* Rücknahmen zeigen auf die Kennung ihrer Erledigung (Kohorte, Runde 2 Befund 7): je Woche 4 Erledigungen, 3 davon zurückgenommen. */
    const fakeZeilen = []; for (const [w, tage] of [['a', 0], ['b', 9]]) { const ids = [...Array(4)].map(() => crypto.randomUUID()); ids.forEach((id, i) => fakeZeilen.push(`insert into public.hh_vorhaben_verlauf (id, vorhaben_id, punkt_id, art, wer, text, status, created_by, source_ref, created_at) values ('${id}', '${K.vorhaben}', '${K.punkt}', 'system', 'lauf', 'Punkt erledigt: Probe ${w}${i} (Test)', '${i < 3 ? 'verworfen' : 'bestaetigt'}', 'lauf', '${K.run}:fake:erl:${w}${i}', now() - interval '${tage} days');`)); ids.slice(0, 3).forEach((id, i) => fakeZeilen.push(`insert into public.hh_vorhaben_verlauf (vorhaben_id, punkt_id, art, wer, text, status, created_by, source_ref, created_at) values ('${K.vorhaben}', '${K.punkt}', 'system', 'Alex', 'Punkt wieder offen: Probe ${w}${i} (Test)', 'bestaetigt', 'Alex', 'rueckgaengig:lauf:${id}', now() - interval '${tage} days');`)); }
    const fake = sql(fakeZeilen.concat(['select 1 as ok;']).join('\n'));
    const t4 = await api('lauf_tick', { run_id: K.run + '-d', postfach: 'alex@wildemoehre.org', mails: [] });
    const e4 = await api('lauf_einstellungen_get', {});
    pruefe('Selbstabschaltung: zwei Wochen je unter 50 % bleibend (ab drei Erledigungen) stellen den Modus auf vorschlag mit Grund', fake.rows?.[0]?.ok === 1 && t4.status === 200 && t4.d.abschaltung?.abgeschaltet === true && e4.d?.einstellungen?.modus === 'vorschlag' && /Selbstabschaltung/.test(e4.d.einstellungen.abbruch_grund || ''), JSON.stringify([fake.fehler, t4.status, t4.d, e4.d?.einstellungen?.modus]).slice(0, 500));
    const sr = await api('lauf_einstellungen_set', { modus: K.modusVorher, by: 'Alex' });
    pruefe('Modus zurück auf den Ausgangswert, Abbruchgrund gelöscht', sr.status === 200 && sr.d.einstellungen.modus === K.modusVorher && (K.modusVorher === 'aus' ? sr.d.einstellungen.abbruch_grund !== undefined : true), JSON.stringify(sr.d).slice(0, 200));
    /* Rückblick-Auswertung läuft über das Protokoll */
    const ra = await api('lauf_retro_auswertung', { run_id: K.run, von: new Date(Date.now() - 86400000).toISOString().slice(0, 10), bis: new Date().toISOString().slice(0, 10) });
    pruefe('Rückblick-Auswertung liefert Zahlen (geprüft, sicher, Präzision, Sichtungen je Tag)', ra.status === 200 && ra.d.geprueft >= 5 && ra.d.sicher >= 2 && typeof ra.d.sichtungen_je_tag === 'number', JSON.stringify(ra.d).slice(0, 300));
  } catch (e) {
    fehler++; console.log('  FEHLT  Ausnahme in der Wirkungsprobe · ' + (e.stack || e.message).slice(0, 400));
  } finally {
    const r = aufraeumen(); const z = r.rows?.[0];
    pruefe('Aufgeräumt: Testvorhaben, Protokoll des Laufs samt Abschaltungszeile, Ticker, Modus wie vorher', !!z && Number(z.vh) === 0 && Number(z.prot) === 0 && Number(z.news) === 0 && z.modus === K.modusVorher && Number(z.tag) === K.tagVorher, JSON.stringify(r).slice(0, 300));
  }
}
console.log(`\n${ok} ok, ${fehler} Abweichungen`);
process.exit(fehler ? 1 : 0);
