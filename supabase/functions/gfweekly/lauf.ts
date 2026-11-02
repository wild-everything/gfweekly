/* Kompass · Stufe 3 (26.10.2026): der Lauf im Kompass (docs/PAKET-STUFE-3-LAUF-IM-KOMPASS.md, Abschnitt 2).
   Aktionen: lauf_tick, lauf_einstellungen_get, lauf_einstellungen_set, lauf_gmail_probe, lauf_retro_auswertung.
   Ein Tick bearbeitet ein Postfach und höchstens `batch` Quellen. Quellen sind Mails aus Gmail (Dienstkonto mit Delegation, Secret
   GOOGLE_SA_JSON), Plattform-Fakten (hh_feed_partner, hh_feed_habitate) und, nur im Probelauf, `mails:[…]` aus der Nutzlast (Fixtures,
   Rückblick aus der Terminal-Sitzung). Mails an die Einwurf-Adressen werden als Einwurf angelegt (wie bisher Regel D des Abgleichs).
   Harte Regeln stehen hier im Code, nicht nur im Prompt (Runde 1, 26.10.2026): Modus `aus` schreibt nichts, auch nicht mit Nutzlast;
   Nutzlast-Mails schreiben nur an Vorhaben mit „(Test)“ im Titel; Postfächer nur aus den Einstellungen; erledigt nur bei „sicher“ mit
   belegtem Abschluss und atomar mit Beleg (hh_lauf_erledigt); nie ein Punkt, der schon einmal zurückgenommen wurde; Deckel je Berliner
   Tag; keine Frist, nur gate_frist am Kandidaten; keine Themen; keine neue Entscheidung ohne Punkt (Kandidaten ohne gate); kein Kandidat
   aus gesendeten Mails; Vertraulichkeitsfilter auf Beleg, Betreff und Kandidat. Schreibwege wie docs/auftraege/STUFE2-LAEUFE.md, deshalb
   gelten Rückgängig (hh_lauf_rueckgaengig), Verfall (hh_vorschlag_verfall) und Bilanz (lauf_bilanz) unverändert. */
// deno-lint-ignore-file no-explicit-any
type Any = any;

export class LaufFehler extends Error { status: number; constructor(m: string, status = 400) { super(m); this.status = status; } }

export const LAUF_MODI = ['aus', 'probe', 'vorschlag', 'live'];
const EINWURF = ['alex+einwurf@wildemoehre.org', 'lea+einwurf@wildemoehre.org'];
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TIMEOUT_MS = 25000;

/* ---- reine Helfer (auch für Proben importierbar) ---- */
export function laufStufe(roh: Any, punktBekannt: boolean, vorhabenBekannt: boolean): 'sicher' | 'wahrscheinlich' | 'unklar' {
  const s = Number(roh?.sicherheit); const sich = isFinite(s) ? Math.max(0, Math.min(1, s)) : 0;
  if (punktBekannt && sich >= 0.8 && roh?.abschluss_belegt === true) return 'sicher';
  if ((punktBekannt || vorhabenBekannt) && sich >= 0.7) return 'wahrscheinlich';   // Stichprobe 26.10.: bei 0,6 kam ein falscher Punktbezug durch
  return 'unklar';
}
export function laufAktion(stufe: string, modus: string, hatPunkt: boolean, hatKandidat: boolean, gesendet: boolean, gesperrt: boolean): string {
  if (stufe === 'sicher' && hatPunkt) { if (gesperrt) return 'gesperrt'; return modus === 'live' ? 'erledigt' : 'vorschlag'; }
  if (stufe === 'wahrscheinlich') return hatPunkt || !hatKandidat ? 'vorschlag' : (gesendet ? 'nichts' : 'kandidat');
  return 'nichts';   // unklar: nichts schreiben (Runde 2, Befund 5)
}
export function mailText(m: Any, max = 3500): string {
  const kopf = `Von: ${m.von || ''}\nAn: ${m.an || ''}\nDatum: ${m.datum || ''}\nBetreff: ${m.betreff || ''}\n`;
  return (kopf + '\n' + String(m.text || m.snippet || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n')).slice(0, max);
}
function datumsAnker(text: string): string[] {
  const aus: string[] = [];
  for (const m of text.matchAll(/\b(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{2,4})?)(?!\d)/g)) {
    const jahr = m[1] || (m[6] ? String(Number(m[6]) + (m[6].length === 2 ? 2000 : 0)) : '');
    const monat = Number(m[2] || m[5]), tag = Number(m[3] || m[4]);
    const probe = new Date(Date.UTC(Number(jahr || 2000), monat - 1, tag));
    aus.push(probe.getUTCMonth() + 1 === monat && probe.getUTCDate() === tag
      ? `${jahr}:${monat}:${tag}` : 'ungueltig');
  }
  return aus;
}
function betragsAnker(text: string): string[] {
  const aus: string[] = [];
  for (const m of text.matchAll(/(?:^|[^\p{L}\p{N}.,+-])(?:(?:€|EUR\b|Euro\b)\s*([+-]?\d+(?:[.,]\d+|[ \u00a0\u202f]\d{3}(?!\d))*)|([+-]?\d+(?:[.,]\d+|[ \u00a0\u202f]\d{3}(?!\d))*)\s*(?:€|EUR\b|Euro\b))/giu)) {
    const roh = m[1] || m[2]; const minus = roh.startsWith('-'); const z = roh.replace(/^[+-]/, '');
    const pos = Math.max(z.lastIndexOf(','), z.lastIndexOf('.'));
    const dezimal = pos >= 0 && z.length - pos - 1 === 2;
    const ganz = dezimal ? z.slice(0, pos) : z; const cent = dezimal ? z.slice(pos + 1) : '00';
    const gruppen = ganz.split(/[., \u00a0\u202f]/);
    if (gruppen.slice(1).some(g => g.length !== 3) || (ganz.includes(',') && ganz.includes('.'))) { aus.push('ungueltig'); continue; }
    const zahl = gruppen.join('').replace(/^0+(?=\d)/, '') + '.' + cent;
    aus.push((minus && zahl !== '0.00' ? '-' : '') + zahl);
  }
  return aus;
}
/* Konkrete Datums- und Geldangaben müssen sämtlich in der Quelle vorkommen.
   Ein gemeinsamer Name darf einen erfundenen Betrag nicht verdecken. Die Prüfung
   belegt nur den Quellenanker, nicht den fachlichen Abschluss einer Handlung. */
export function belegVerankert(beleg: string, quelle: { betreff?: string; text?: string; von?: string }): boolean {
  const b = String(beleg || '');
  if (b.length < 20) return false;
  const quelleText = `${quelle.betreff || ''} ${quelle.von || ''} ${quelle.text || ''}`;
  const daten = datumsAnker(b), betraege = betragsAnker(b);
  const quellDaten = new Set(datumsAnker(quelleText)), quellBetraege = new Set(betragsAnker(quelleText));
  if (daten.some(d => d === 'ungueltig' || !quellDaten.has(d)) || betraege.some(g => g === 'ungueltig' || !quellBetraege.has(g))) return false;
  if (daten.length || betraege.length) return true;
  const woerter = new Set((quelleText.match(/\b[A-ZÄÖÜ][\wäöüß-]{4,}\b/g) || []).map(w => w.toLowerCase()));
  const allgemein = new Set(['hallo', 'liebe', 'lieber', 'viele', 'grüße', 'danke', 'freundliche', 'sehr', 'geehrte', 'betreff', 'datum', 'alex', 'alexander', 'wilde', 'möhre', 'gmbh', 'festival']);
  return (b.match(/\b[A-ZÄÖÜ][\wäöüß-]{4,}\b/g) || []).some(w => woerter.has(w.toLowerCase()) && !allgemein.has(w.toLowerCase()));
}

function quellRef(m: Any): string {
  return `${m.quelle_art === 'plattform' ? 'feed' : 'mail'}:${String(m.thread_id || '').slice(0, 80) || 'x'}:${String(m.message_id || '').slice(0, 80) || 'x'}`;
}
async function quellMetadaten(m: Any, fixture: boolean): Promise<Any> {
  const bytes = new TextEncoder().encode(JSON.stringify([m.betreff || '', m.von || '', m.an || '', m.text || m.snippet || '', !!m.gesendet, m.datum || '', m.url || '']));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
  return { art: m.quelle_art === 'plattform' ? 'plattform' : 'mail', fixture,
    thread_id: String(m.thread_id || '').slice(0, 200), message_id: String(m.message_id || '').slice(0, 200),
    datum: m.datum && !isNaN(Date.parse(m.datum)) ? new Date(m.datum).toISOString() : '', hash,
    feed_tabelle: String(m.feed_tabelle || ''), platform: String(m.platform || ''),
    ref_table: String(m.ref_table || ''), ref_id: String(m.ref_id || '') };
}
export function istEinwurfMail(m: Any): boolean { const an = String(m.an || '').toLowerCase(); return EINWURF.some(e => an.includes(e)); }
/* Selbstabschaltung (Stufe 4): zwei getrennte Wochen, jede mit mindestens drei Erledigungen und unter 50 % bleibend. */
export function abschaltungFaellig(w1: { erledigt: number; zurueck: number }, w2: { erledigt: number; zurueck: number }, mindest = 5): boolean {
  const quote = (w: { erledigt: number; zurueck: number }) => w.erledigt ? (w.erledigt - w.zurueck) / w.erledigt : 1;
  return w1.erledigt + w2.erledigt >= mindest && w1.erledigt > 0 && w2.erledigt > 0 && quote(w1) < 0.5 && quote(w2) < 0.5;   // Runde 3, Befund 8: fünf Fälle über beide Wochen, jede Woche unter 50 %
}
/* Vertraulichkeit: Zugangsdaten, Kontonummern, Gesundheit, Bewertungen von Menschen. Wortliste, kein Verständnis; die Prompt-Regel bleibt zusätzlich. */
export const LAUF_VERTRAULICH = /(passwort|kennwort|zugangsdaten|\bpin\b|\btan\b|\biban\b|\bDE\d{2}(?:\s?\d{4}){4}|\b(?:\d{4}[ -]?){3}\d{4}\b|krank|diagnose|therapie|psychisch|depress|burn-?out|schwanger|\barzt|klinik|gesundheit|ungeeignet|unfähig|inkompetent|\bfaul\b|unzuverlässig|untragbar|versag|\bdumm|\bidiot|nicht tragbar|traut .{0,40}(nicht|kein)|nicht mehr zu\b|vertrauen (in|zu) \w+ (ist|sei|war)|eignung|charakter|verhalten von|zu nichts|abmahnung|kündigung|privat)/i;

function b64url(x: string | ArrayBuffer): string {
  const bytes = typeof x === 'string' ? new TextEncoder().encode(x) : new Uint8Array(x);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const t = s.replace(/-/g, '+').replace(/_/g, '/'); const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : '';
  const bin = atob(t + pad); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
function pemToDer(pem: string): ArrayBuffer {
  const b = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
const berlinTag = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

export function laufModul(deps: { admin: Any; json: (b: Any, s?: number) => Response; heuteBerlin: () => string; whoNorm: (s: string) => string;
  rueckkehrLage?: (t: Any) => Promise<Any>; laufBilanz?: (t: Any) => Promise<Any>; einwurfAnlegen?: (text: string, von: string, sourceRef: string, kanal: string) => Promise<Any> }) {
  const { admin, json, heuteBerlin, whoNorm } = deps;
  const tokens = new Map<string, { token: string; bis: number }>();

  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) {
      const code = (error as Any).code || '';
      const status = code === 'PT404' ? 404 : code === 'PT409' ? 409 : code === 'PT400' ? 400 : 500;
      throw new LaufFehler(String(error.message || 'Datenbankfehler').replace(/^.*?:\s*/, ''), status);
    }
    return data;
  }
  async function schreibe(tabelle: string, row: Any, onConflict: string) {
    const { error } = await admin.from(tabelle).upsert(row, { onConflict, ignoreDuplicates: true });
    if (error) throw new LaufFehler(`${tabelle}: ${error.message}`, 500);
  }
  function by(t: Any): string {
    const w = whoNorm((t?.by ?? '').toString().trim());
    if (w !== 'Alex' && w !== 'Lea') throw new LaufFehler('by muss Alex oder Lea sein');
    return w;
  }
  async function einstellungen(): Promise<Any> {
    const { data, error } = await admin.from('hh_lauf_einstellungen').select('*').eq('id', 1).maybeSingle();
    if (error) throw error; if (!data) throw new LaufFehler('Einstellungen fehlen (Migration 20261026120000)', 500);
    return data;
  }

  /* ---- Google: Dienstkonto mit domänenweiter Delegation, JWT mit WebCrypto, kein Schlüssel im Log ---- */
  async function versuchLage(): Promise<Record<string, number>> {
    const aus: Record<string, number> = {};
    for (const status of ['wiederholen','wirkung_offen','erschoepft']) {
      const { count, error } = await admin.from('hh_lauf_versuche').select('quelle_ref', { count: 'exact', head: true }).eq('status', status);
      if (error) throw error;
      aus[status] = count || 0;
    }
    return aus;
  }
  function saLesen(): Any {
    const raw = (Deno.env.get('GOOGLE_SA_JSON') || '').trim();
    if (!raw) throw new LaufFehler('Google-Zugang fehlt: Supabase-Secret GOOGLE_SA_JSON setzen (Paket Stufe 3, Abschnitt 2.4)', 503);
    try { return JSON.parse(raw.startsWith('{') ? raw : atob(raw)); } catch { throw new LaufFehler('GOOGLE_SA_JSON ist kein JSON (roh oder base64)', 503); }
  }
  async function gmailToken(postfach: string): Promise<string> {
    const c = tokens.get(postfach); if (c && c.bis > Date.now() + 60000) return c.token;
    const sa = saLesen();
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: sa.client_email, sub: postfach, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + claim));
    const jwt = `${header}.${claim}.${b64url(sig)}`;
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new LaufFehler('Google-Token für ' + postfach + ' abgelehnt: ' + (d.error_description || d.error || r.status) + ' (Delegation für ' + SCOPE + ' eingetragen?)', 502);
    tokens.set(postfach, { token: d.access_token, bis: Date.now() + (Number(d.expires_in) || 3600) * 1000 });
    return d.access_token;
  }
  async function gmailGet(postfach: string, pfad: string): Promise<Any> {
    const token = await gmailToken(postfach);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + pfad, { headers: { authorization: 'Bearer ' + token }, signal: ctl.signal });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new LaufFehler('Gmail ' + postfach + ': ' + (d?.error?.message || r.status), 502);
      return d;
    } finally { clearTimeout(timer); }
  }
  function kopf(headers: Any[], name: string): string { return (headers || []).find((h: Any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || ''; }
  function textTeil(payload: Any): string {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) return b64urlDecode(payload.body.data);
    for (const p of payload.parts || []) { const t = textTeil(p); if (t) return t; }
    if (payload.mimeType === 'text/html' && payload.body?.data) return b64urlDecode(payload.body.data).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    return '';
  }
  /* Threads eines Postfachs im Fenster; je Thread die jüngste Nachricht als Quelle, der Threadtext (höchstens 3 Nachrichten) als Kontext. */
  function threadQuelle(th: Any, messageId?: string): Any {
    const alle = th.messages || [];
    const i = messageId ? alle.findIndex((m: Any) => m.id === messageId) : alle.length - 1;
    if (i < 0) throw new LaufFehler('Reservierte Nachricht nicht mehr verfügbar', 409);
    const msgs = alle.slice(Math.max(0, i - 2), i + 1), letzte = alle[i];
    const h = letzte.payload?.headers || [];
    const text = msgs.map((m: Any) => `[${kopf(m.payload?.headers, 'Date')}] ${kopf(m.payload?.headers, 'From')}: ${textTeil(m.payload).slice(0, 1500)}`).join('\n\n');
    return { thread_id: th.id, message_id: letzte.id, von: kopf(h, 'From'), an: kopf(h, 'To') + (kopf(h, 'Cc') ? ', ' + kopf(h, 'Cc') : ''), betreff: kopf(h, 'Subject'), datum: new Date(Number(letzte.internalDate)).toISOString(),
      text, gesendet: (letzte.labelIds || []).includes('SENT'), labels: letzte.labelIds || [], quelle_art: 'mail' };
  }
  /* Nur genau diese Nachricht überspringen. Eine spätere Nachricht desselben Threads bleibt neu. */
  async function gmailMails(postfach: string, q: string, max: number, schonDa: (ref: string) => Promise<boolean> = async () => false): Promise<Any[] & { mehr?: boolean }> {
    const liste = await gmailGet(postfach, `threads?maxResults=${Math.min(50, Math.max(max * 2, 10))}&q=${encodeURIComponent(q)}`);
    const aus: Any[] & { mehr?: boolean } = [];
    aus.mehr = !!liste.nextPageToken || (liste.threads || []).length > max;
    for (const t of (liste.threads || [])) {
      if (aus.length >= max) { aus.mehr = true; break; }
      const th = await gmailGet(postfach, `threads/${t.id}?format=full`);
      if (!th.messages?.length) continue;
      const m = threadQuelle({ ...th, id: t.id });
      if (!await schonDa(quellRef(m))) aus.push(m);
    }
    return aus;
  }
  /* Plattform-Fakten (bisher Regel E des Abgleichs): Zeilen der Feeds seit der Zeitgrenze als Quellen wie eine Mail. */
  async function feedQuellen(seit: Date, bis: Date, max: number): Promise<Any[]> {
    const aus: Any[] = [];
    for (const tab of ['hh_feed_partner', 'hh_feed_habitate']) {
      const { data, error } = await admin.from(tab).select('happened_at,platform,kind,title,body,ref_table,ref_id,url,who').gt('happened_at', seit.toISOString()).lte('happened_at', bis.toISOString()).order('happened_at', { ascending: false }).limit(max);
      if (error) throw new LaufFehler(`${tab}: ${error.message}`, 500);
      for (const f of (data || []) as Any[]) aus.push(feedQuelle(tab, f));
    }
    return aus.slice(0, max);
  }
  function feedQuelle(tab: string, f: Any): Any {
    return { thread_id: `feed:${f.platform || tab}:${f.ref_table || ''}:${f.ref_id || ''}`, message_id: String(Date.parse(f.happened_at) || ''), von: `${f.platform || tab} (${f.who || 'Plattform'})`, an: 'Kompass', betreff: f.title || f.kind || tab, datum: f.happened_at, text: f.body || '', gesendet: false, quelle_art: 'plattform', url: f.url || null,
      feed_tabelle: tab, platform: f.platform || '', ref_table: f.ref_table || '', ref_id: f.ref_id || '' };
  }
  async function wiederQuelle(postfach: string, q: Any): Promise<Any> {
    let m: Any;
    if (q.art === 'mail') m = threadQuelle(await gmailGet(postfach, `threads/${encodeURIComponent(q.thread_id)}?format=full`), q.message_id);
    else {
      if (!['hh_feed_partner','hh_feed_habitate'].includes(q.feed_tabelle)) throw new LaufFehler('Unzulässige Feedquelle', 400);
      const { data, error } = await admin.from(q.feed_tabelle).select('happened_at,platform,kind,title,body,ref_table,ref_id,url,who')
        .eq('happened_at', q.datum).eq('platform', q.platform).eq('ref_table', q.ref_table).eq('ref_id', q.ref_id).limit(2);
      if (error || data?.length !== 1) throw new LaufFehler('Reservierter Feedstand nicht eindeutig verfügbar', 409);
      m = feedQuelle(q.feed_tabelle, data[0]);
    }
    if ((await quellMetadaten(m, false)).hash !== q.hash) throw new LaufFehler('Reservierte Quellfassung verändert', 409);
    return m;
  }

  /* ---- Kontext: aktive Vorhaben mit offenen Punkten (im Rückblick auch Punkte, die seit `kontextAb` erledigt wurden), gesperrte Punkte ---- */
  async function kontext(kontextAb: string | null) {
    const pq = admin.from('hh_vorhaben_punkte').select('id,vorhaben_id,titel,stand,wer,frist,erledigt,erledigt_at');
    const vq = admin.from('hh_vorhaben').select('id,slug,title,status,phase,fokus,ball,ball_name,stand,naechster_schritt,frist').order('sort');
    const [vh, pk, sperre] = await Promise.all([
      kontextAb ? vq : vq.in('status', ['aktiv', 'pausiert']),
      kontextAb ? pq.or(`erledigt.eq.false,erledigt_at.gte.${kontextAb}`) : pq.eq('erledigt', false),
      admin.from('hh_vorhaben_verlauf').select('punkt_id').like('source_ref', 'rueckgaengig:lauf:%'),
    ]);
    for (const r of [vh, pk, sperre]) if (r.error) throw r.error;
    const punkte = new Map<string, Any[]>();
    for (const p of (pk.data || []) as Any[]) { if (!punkte.has(p.vorhaben_id)) punkte.set(p.vorhaben_id, []); punkte.get(p.vorhaben_id)!.push(p); }
    /* Im Rückblick zählen auch inzwischen abgeschlossene Vorhaben, sofern sie seit kontextAb erledigte Punkte haben (Runde 2, Befund 8). */
    const liste = ((vh.data || []) as Any[]).filter(v => ['aktiv', 'pausiert'].includes(v.status) || (punkte.get(v.id) || []).some((p: Any) => p.erledigt)).map(v => ({ ...v, punkte: punkte.get(v.id) || [] }));
    return { liste, gesperrt: new Set(((sperre.data || []) as Any[]).map(x => x.punkt_id).filter(Boolean)) };
  }

  /* ---- Claude: eine Quelle gegen die Akten einordnen (Werkzeugschema wie der Einwurf) ---- */
  async function einordnen(mail: Any, ktx: Any[], modell: string, person: string): Promise<Any> {
    const key = Deno.env.get('ANTHROPIC_API_KEY') || ''; if (!key) throw new LaufFehler('ANTHROPIC_API_KEY fehlt', 503);
    const system = `Du prüfst für die Geschäftsführung der Wilde Möhre GmbH (Alex und Lea), ob eine E-Mail oder ein Plattform-Eintrag belegt, dass ein offener Punkt eines laufenden Vorhabens erledigt ist, oder ob die Quelle ein Vorhaben betrifft. Du entscheidest nichts, du ordnest ein.
Regeln:
- vorhaben_slug nur aus der Liste; passt keines eindeutig, nenne den besten Treffer mit sicherheit unter 0.5.
- punkt_id nur aus den Punkten dieses Vorhabens. abschluss_belegt ist nur dann true, wenn die Quelle die Handlung des Punkts als geschehen zeigt (gesendete Antwort, Zusage, Zahlung, Termin bestätigt, Unterschrift), nicht wenn sie nur darüber spricht.
- sicherheit: 0.9 und mehr nur, wenn Betreff oder Text den Punkt oder den Partner in seiner Rolle eindeutig nennen; sonst niedriger.
- beleg: ein Satz mit Datum, Betrag oder Name, wenn vorhanden. Keine Zitate, keine Zugangsdaten, keine Konto- oder Kartennummern, keine Bewertungen von Personen.
- kandidat: nur, wenn die Quelle eine neue Entscheidung oder Aufgabe der Geschäftsführung nennt, die noch kein Punkt ist; sonst null. Keine Kandidaten aus Newslettern, Rechnungen, Systemmails, Kalendereinladungen, privater Post.
- frist_datum: nur ein Datum, das in der Quelle steht (JJJJ-MM-TT), sonst null.
- Vertraulich: keine Aussagen über Gesundheit, Befinden oder Eignung von Personen, keine Bewertungen von Menschen, keine privaten Angelegenheiten; Personalthemen nur auf Sachebene.
- Erfinde nichts. Sprache Deutsch, keine Gedankenstriche.`;
    const liste = ktx.map(v => ({ slug: v.slug, titel: v.title, phase: v.phase, stand: v.stand, naechster_schritt: v.naechster_schritt,
      offene_punkte: v.punkte.map((p: Any) => ({ id: p.id, titel: p.titel, stand: p.stand, wer: p.wer, frist: p.frist, erledigt_am: p.erledigt ? p.erledigt_at : null })) }));
    const body = {
      model: modell, max_tokens: 900, system,
      tools: [{ name: 'einordnung', description: 'Einordnung der Quelle gegen die Akten.', input_schema: { type: 'object', additionalProperties: false, required: ['vorhaben_slug', 'sicherheit', 'abschluss_belegt', 'beleg'],
        properties: { vorhaben_slug: { type: ['string', 'null'] }, punkt_id: { type: ['string', 'null'] }, sicherheit: { type: 'number' }, abschluss_belegt: { type: 'boolean' }, beleg: { type: 'string' },
          kandidat: { type: ['object', 'null'], properties: { titel: { type: 'string' }, body: { type: 'string' } }, required: ['titel'] }, frist_datum: { type: ['string', 'null'] } } } }],
      tool_choice: { type: 'auto' },   // claude-opus-5-5 lässt keine erzwungene Werkzeugwahl zu; Rückfall unten liest JSON aus dem Text
      messages: [{ role: 'user', content: `Antworte ausschließlich über das Werkzeug „einordnung“ (oder, falls nicht möglich, mit genau einem JSON-Objekt mit denselben Feldern).\nHeute: ${heuteBerlin()}. Postfach: ${person}. ${mail.quelle_art === 'plattform' ? 'Die Quelle ist ein Plattform-Eintrag.' : mail.gesendet ? 'Die Mail wurde von dieser Person gesendet.' : 'Die Mail ist eingegangen.'}\n\nQuelle:\n${mailText(mail)}\n\nAktive Vorhaben:\n${JSON.stringify(liste)}` }],
    };
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new LaufFehler('Anthropic: ' + (data?.error?.message || res.status), 502);
      const tool = (data.content || []).find((c: Any) => c.type === 'tool_use');
      if (tool?.input) return tool.input;
      const text = (data.content || []).filter((c: Any) => c.type === 'text').map((c: Any) => c.text).join('\n');
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch { /* unten */ } }
      throw new LaufFehler('Anthropic: keine Antwort im erwarteten Format', 502);
    } finally { clearTimeout(timer); }
  }

  const txt = (x: unknown, n: number) => (x ?? '').toString().trim().slice(0, n);
  const tag = (x: unknown) => { const s = txt(x, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) ? s : null; };
  const sauber = (x: unknown, n: number, ersatz: string) => { const s = txt(x, n); return !s || LAUF_VERTRAULICH.test(s) ? ersatz : s; };

  /* ---- ein Tick ---- */
  async function tick(t: Any) {
    const e = await einstellungen();
    const fixtures = Array.isArray(t.mails);
    const probe = t.probe === true;
    const modus = probe ? 'probe' : e.modus;
    if (modus === 'aus') return { uebersprungen: true, modus, grund: 'Lauf ist aus' };   // Runde 1, Befund 1: aus schreibt nie, auch nicht mit Nutzlast
    const runId = txt(t.run_id, 80) || `lauf-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
    const heute = heuteBerlin();
    const batch = Math.max(1, Math.min(50, parseInt(t.batch) || e.batch || 8));
    const erlaubt: string[] = e.postfaecher || [];
    let postfach = txt(t.postfach, 120);
    let mails: Any[] = [];
    let quelle = 'nutzlast';
    let cursorNeu: string | null = null;
    let mehrMails = false;
    let neueMails: Any[] = [];
    if (fixtures) {
      postfach = postfach || 'fixtures';
      if (postfach !== 'fixtures' && !erlaubt.includes(postfach)) throw new LaufFehler('postfach nicht erlaubt');   // Runde 1, Befund 2
      mails = t.mails.slice(0, batch).map((m: Any) => ({ ...m, _versuch: null, quelle_art: m.quelle_art === 'plattform' ? 'plattform' : 'mail' }));
    } else {
      quelle = 'gmail';
      if (!postfach) {
        const { data: cur } = await admin.from('hh_lauf_cursor').select('postfach,bis_at');
        const c = new Map<string, string>(((cur || []) as Any[]).map(x => [x.postfach, x.bis_at]));
        postfach = [...erlaubt].sort((a: string, b: string) => String(c.get(a) || '').localeCompare(String(c.get(b) || '')))[0] || '';
      }
      if (!postfach || !erlaubt.includes(postfach)) throw new LaufFehler('postfach nicht erlaubt (nur die eingestellten Postfächer)');
      if (modus !== 'probe' && !t.after && !t.before) {
        const offen = await rpc('hh_lauf_versuch_offen', { p_postfach: postfach, p_modus: modus, p_limit: batch });
        mails = (offen || []).map((v: Any) => ({ _versuch: v, datum: v.quelle.datum }));
      }
      if (mails.length < batch) {
        const { data: cur } = await admin.from('hh_lauf_cursor').select('bis_at,rest_bis').eq('postfach', postfach).maybeSingle();
        const seit = t.after ? new Date(t.after) : new Date(cur?.bis_at ? Date.parse(cur.bis_at) - 3600e3 : Date.now() - (e.fenster_stunden || 26) * 3600e3);
        /* Runde 2, Befund 1: war der letzte Stapel voll, liegt die obere Grenze des ungelesenen Rests in rest_bis; der Tick liest erst darunter weiter. */
        const rest = !t.after && !t.before && cur?.rest_bis ? new Date(cur.rest_bis) : null;
        const bisD = t.before ? new Date(t.before) : (rest || new Date());
        /* Hauptpostfach ohne Werbung, Soziales, Benachrichtigungen und Foren (GitHub, Netlify, Stripe, Newsletter); Einwurf-Mails eigens; XCeed-Berichte über die Plus-Adresse. */
        const zeit = `after:${Math.floor(seit.getTime() / 1000)} before:${Math.floor(bisD.getTime() / 1000) + 1}`;
        const schonDa = async (ref: string) => {
          if (mails.some(m => m._versuch?.quelle_ref === ref)) return true;
          const { data, error } = await admin.from('hh_lauf_protokoll').select('modus,ausgefuehrt').eq('quelle_ref', ref);
          if (error) throw error;
          // Fehler werden ausschließlich über den atomaren Versuchsnachweis wiederaufgenommen.
          return ((data || []) as Any[]).some((x: Any) => x.ausgefuehrt || x.modus === modus);
        };
        const haupt = await gmailMails(postfach, `${zeit} -category:promotions -category:social -category:updates -category:forums ${EINWURF.map(x => '-to:' + x).join(' ')}`, batch - mails.length, schonDa);
        mails.push(...haupt); mehrMails = !!haupt.mehr;
        const einwurfAdresse = EINWURF.find(x => x.startsWith(postfach.split('@')[0] + '+')) || null;
        if (einwurfAdresse && mails.length < batch) { const x = await gmailMails(postfach, `${zeit} to:${einwurfAdresse}`, batch - mails.length, schonDa); mails.push(...x.filter(m => !mails.some(y => !y._versuch && quellRef(y) === quellRef(m)))); }
        if (/^alex/i.test(postfach) && mails.length < batch) { const x = await gmailMails(postfach, `${zeit} to:alex+xceed@wildemoehre.org`, batch - mails.length, schonDa); mails.push(...x.filter(m => !mails.some(y => !y._versuch && quellRef(y) === quellRef(m)))); }
        if (postfach === erlaubt[0] && mails.length < batch) mails.push(...await feedQuellen(seit, bisD, batch - mails.length));
        cursorNeu = t.after || t.before ? null : (rest ? cur.bis_at : new Date().toISOString());
        neueMails = mails.filter(m => !m._versuch);
      }
    }
    const person = /^lea/i.test(postfach) ? 'Lea' : 'Alex';
    const kontextAb = t.after ? new Date(t.after).toISOString() : (t.kontext_ab ? new Date(t.kontext_ab).toISOString() : null);
    const { liste, gesperrt } = await kontext(kontextAb && !isNaN(Date.parse(kontextAb)) ? kontextAb : null);
    const bySlug = new Map<string, Any>(liste.map((v: Any) => [v.slug, v]));
    const zusammen: Record<string, number> = { geprueft: 0, erledigt: 0, vorschlag: 0, kandidat: 0, einwurf: 0, unklar: 0, gedeckelt: 0, gesperrt: 0, uebersprungen: 0, nichts: 0, fehler: 0 };
    const zeilen: Any[] = [];
    for (let m of mails) {
      const ref = m._versuch?.quelle_ref || quellRef(m);
      /* Runde 1, Befund 4: ein Probelauf sperrt nichts; übersprungen wird nur, was im selben Modus schon protokolliert oder tatsächlich ausgeführt ist. */
      let versuch: Any = null;
      if (modus === 'probe') {
        const { data: schon, error } = await admin.from('hh_lauf_protokoll').select('modus,ausgefuehrt').eq('quelle_ref', ref);
        if (error) throw error;
        if ((schon || []).some((x: Any) => x.ausgefuehrt || x.modus === modus)) { zusammen.uebersprungen++; continue; }
      } else {
        versuch = await rpc('hh_lauf_versuch_start', { p_postfach: postfach, p_ref: ref, p_modus: modus, p_quelle: m._versuch?.quelle || await quellMetadaten(m, fixtures) });
        if (!versuch?.reserviert) { zusammen.uebersprungen++; continue; }
      }
      const vorSchreiben = async () => { if (versuch) await rpc('hh_lauf_versuch_schreiben', { p_token: versuch.token }); };
      let zeile: Any = { run_id: runId, modus, postfach, quelle_art: m.quelle_art === 'plattform' ? 'plattform' : 'mail', quelle_ref: ref, punkt_id: null, vorhaben_id: null, stufe: 'keine', aktion: 'nichts', beleg: null, ausgefuehrt: false, quelle_at: m.datum && !isNaN(Date.parse(m.datum)) ? new Date(m.datum).toISOString() : null };
      zeile.versuch = versuch?.versuch || 0;
      try {
        if (m._versuch) {
          m = await wiederQuelle(postfach, m._versuch.quelle);
          if (quellRef(m) !== ref) throw new LaufFehler('Reservierte Quellenkennung verändert', 409);
          zeile.quelle_art = m.quelle_art;
        }
        if (istEinwurfMail(m)) {
          /* Regel D des Abgleichs: Einwurf-Mails werden Einwürfe mit Vorschlag (Einwurf-Weg der Akte). */
          zeile.quelle_art = 'einwurf'; zeile.beleg = 'Einwurf aus Mail';
          if (modus === 'probe' || !deps.einwurfAnlegen || fixtures) { zeile.aktion = 'uebersprungen'; if (fixtures && modus !== 'probe') zeile.beleg = 'Einwurf aus der Nutzlast: nicht angelegt (Runde 2, Befund 4)'; }
          else { await vorSchreiben(); const ew = await deps.einwurfAnlegen(mailText(m, 2000), person, `${ref}:einwurf`, 'mail'); zeile.aktion = ew?.doppelt ? 'uebersprungen' : 'nichts'; zeile.ausgefuehrt = !ew?.doppelt; zusammen.einwurf += ew?.doppelt ? 0 : 1; }
        } else {
          zusammen.geprueft++;
          const roh = await einordnen(m, liste, e.modell, person);
          const vh = roh?.vorhaben_slug ? bySlug.get(String(roh.vorhaben_slug)) : null;
          const sichRoh = Number(roh?.sicherheit) || 0;
          const punkt = vh && roh?.punkt_id && sichRoh >= 0.75 ? (vh.punkte as Any[]).find((p: Any) => p.id === String(roh.punkt_id)) : null;   // Punktbezug nur bei hoher Sicherheit
          const stufe = laufStufe(roh, !!punkt, !!vh);
          const beleg = sauber(roh?.beleg, 600, 'Beleg weggelassen (möglicherweise vertraulich)');
          const kand = roh?.kandidat && sauber(roh.kandidat.titel, 300, '') ? { titel: sauber(roh.kandidat.titel, 300, ''), body: sauber(roh.kandidat.body, 600, '') } : null;
          const gesp = !!punkt && gesperrt.has(punkt.id);
          let aktion = laufAktion(stufe, modus, !!punkt, !!kand && !!vh, !!m.gesendet, gesp);
          if (punkt && punkt.erledigt && aktion !== 'nichts') aktion = 'nichts';   // Rückblick: schon erledigte Punkte nur protokollieren
          const belegKonkret = !!txt(roh?.beleg, 600) && !LAUF_VERTRAULICH.test(txt(roh?.beleg, 600)) && belegVerankert(txt(roh?.beleg, 600), m);
          if (aktion === 'erledigt' && !belegKonkret) aktion = 'vorschlag';   // Runde 2, Befund 2: ohne konkreten Belegsatz kein automatisches Erledigen
          zeile = { ...zeile, punkt_id: punkt?.id || null, vorhaben_id: vh?.id || null, stufe, aktion, beleg: beleg || null };
          const frist = tag(roh?.frist_datum);
          const link = m.quelle_art === 'plattform' ? (m.url || null) : (quelle === 'gmail' && m.thread_id ? `https://mail.google.com/mail/u/0/#all/${m.thread_id}` : null);
          /* Runde 1, Befund 3: Quellen aus der Nutzlast schreiben außerhalb des Probelaufs nur an Vorhaben mit „(Test)“ im Titel. */
          const darfSchreiben = modus !== 'probe' && (!fixtures || /\(Test\)/.test(String(vh?.title || '')));
          if (modus !== 'probe' && fixtures && !darfSchreiben && ['erledigt', 'vorschlag', 'kandidat'].includes(aktion)) { zeile.aktion = 'uebersprungen'; zeile.beleg = 'Quelle aus der Nutzlast außerhalb des Probelaufs: nicht geschrieben'; }
          else if (darfSchreiben && (aktion === 'vorschlag' || aktion === 'kandidat')) {
            await vorSchreiben(); // Auch die Reservierung des Tagesdeckels ist bereits eine Schreibwirkung.
            const frei = await rpc('hh_lauf_sichtung', { p_tag: heute, p_n: 1 });
            if (Number(frei) < 1) zeile.aktion = 'gedeckelt';
          }
          if (darfSchreiben && zeile.aktion === 'erledigt') {
            await vorSchreiben();
            /* Runde 1, Befund 7: Abschluss und Beleg in einer Transaktion (hh_lauf_erledigt). */
            await rpc('hh_lauf_erledigt', { p_punkt: punkt.id, p_ref: ref, p_beleg: `Erledigt (Lauf): ${beleg || 'Beleg in der Quelle'}`, p_url: link, p_happened: m.datum || new Date().toISOString(), p_art: m.quelle_art === 'plattform' ? 'plattform' : 'mail' });
            zeile.ausgefuehrt = true;
          } else if (darfSchreiben && zeile.aktion === 'vorschlag' && vh) {
            const tg = punkt ? (stufe === 'sicher' || roh?.abschluss_belegt ? 'Vorschlag: Punkt erledigt' : 'Vorschlag: Stand') : 'Vorschlag: Stand';
            const text = punkt ? `${beleg || 'Die Quelle'} spricht dafür, dass „${punkt.titel}“ ${tg === 'Vorschlag: Punkt erledigt' ? 'erledigt ist' : 'sich geändert hat'}.` : `${beleg || 'Die Quelle'} betrifft dieses Vorhaben.`;
            await schreibe('hh_vorhaben_verlauf', { vorhaben_id: vh.id, punkt_id: punkt?.id || null, art: m.quelle_art === 'plattform' ? 'plattform' : 'mail', wer: 'Lauf', text: text.slice(0, 2000), tag: tg, status: 'vorschlag', created_by: 'lauf', source_ref: `${ref}:vorschlag:${punkt?.id || 'k'}`, source_url: link, happened_at: m.datum || new Date().toISOString() }, 'source_ref');
            zeile.ausgefuehrt = true;
          } else if (darfSchreiben && zeile.aktion === 'kandidat' && kand) {
            /* Runde 1, Befund 6: ohne gate; der Kandidat ist ein Vorschlag an ein Vorhaben im Korb, keine Entscheidung ohne Punkt. */
            await schreibe('gfweekly_news', { kind: 'kandidat', title: kand.titel, body: kand.body || null, who: person, source: m.quelle_art === 'plattform' ? 'plattform' : 'mail', source_title: sauber(m.betreff, 200, 'Quelle'), source_url: link || '', source_ref: `${ref}:k1`, happened_at: m.datum || new Date().toISOString(), status: 'neu', relevance: 'mittel', gate: null, gate_frist: frist, vorhaben_vorschlag: vh?.id || null, run_id: runId }, 'source_ref');
            zeile.ausgefuehrt = true;
          }
        }
      } catch (err) {
        zeile.aktion = 'fehler'; zeile.beleg = `Verarbeitung fehlgeschlagen (${err instanceof LaufFehler ? err.status : 500}); keine Quelldaten im Fehlerprotokoll.`;
      }
      if (versuch) await rpc('hh_lauf_versuch_ende', { p_token: versuch.token, p_ergebnis: zeile.aktion === 'fehler' ? 'fehler' : zeile.aktion === 'gedeckelt' ? 'gedeckelt' : 'fertig' });
      zusammen[zeile.aktion] = (zusammen[zeile.aktion] || 0) + 1;
      if (zeile.stufe === 'unklar') zusammen.unklar++;
      await schreibe('hh_lauf_protokoll', zeile, 'schluessel');
      zeilen.push({ ref, betreff: txt(m.betreff, 80), stufe: zeile.stufe, aktion: zeile.aktion, punkt: zeile.punkt_id, beleg: zeile.beleg });
    }
    if (cursorNeu && modus !== 'probe') {
      /* Voller Stapel: die älteste gelesene Mail wird obere Grenze des Rests (nächster Tick liest darunter); sonst ist das Fenster abgeschlossen. */
      const voll = mehrMails;   // Gmail hätte weitere Treffer im Fenster
      const aeltestes = voll ? neueMails.map(m => String(m.datum || '')).filter(Boolean).sort()[0] : null;
      const { error } = await admin.from('hh_lauf_cursor').upsert({ postfach, bis_at: cursorNeu, rest_bis: voll && aeltestes ? aeltestes : null, updated_at: new Date().toISOString() }, { onConflict: 'postfach' });
      if (error) throw new LaufFehler('Cursor: ' + error.message, 500);
    }
    let abschaltung: Any = null;
    if (modus === 'live') abschaltung = await selbstabschaltung();
    let brief: Any = null;
    if (modus !== 'probe' && !fixtures) brief = await rueckkehrBriefe(e.modell).catch((err: Error) => ({ fehler: err.message }));
    /* Runde 1, Befund 16: im Probelauf nur Protokoll, kein letzter Lauf, kein Ticker. */
    if (modus !== 'probe') {
      const lage = await versuchLage();
      const hinweis = lage.wirkung_offen || lage.erschoepft ? `Offen zur Klärung: ${lage.wirkung_offen} Schreibausgänge, ${lage.erschoepft} ausgeschöpfte Quellen.` : null;
      await admin.from('hh_lauf_einstellungen').update({ letzter_lauf_at: new Date().toISOString(), letzter_fehler: hinweis || (zusammen.fehler ? `${zusammen.fehler} Fehler im Lauf ${runId}` : null), updated_at: new Date().toISOString() }).eq('id', 1);
      if (mails.length && !fixtures) {
        const { data: tagz } = await admin.from('hh_lauf_protokoll').select('aktion,created_at').gte('created_at', new Date(Date.now() - 36 * 3600e3).toISOString());
        const z: Record<string, number> = {}; for (const r of (tagz || []) as Any[]) if (berlinTag(r.created_at) === heute) z[r.aktion] = (z[r.aktion] || 0) + 1;
        await schreibe('gfweekly_news', { kind: 'ticker', source_url: '', title: `Lauf ${heute}: erledigt ${z.erledigt || 0}, Vorschläge ${z.vorschlag || 0}, Kandidaten ${z.kandidat || 0}, unklar oder nichts ${z.nichts || 0}${z.gedeckelt ? ', gedeckelt ' + z.gedeckelt : ''}`, body: `Modus ${modus}, Postfach ${postfach}.`, who: 'Lauf', source: 'notiz', relevance: 'niedrig', source_ref: `lauf:tag:${heute}`, happened_at: new Date().toISOString(), status: 'neu' }, 'source_ref');   // source laut CHECK: notiz, asana, kalender, mail, protokoll, entscheidung, manuell, plattform
      }
    }
    return { run_id: runId, modus, postfach, quelle, mails: mails.length, zusammen, zeilen, cursor: cursorNeu, abschaltung, brief };
  }

  /* Stufe 4: zwei getrennte Wochen mit je mindestens drei Erledigungen und unter 50 % bleibend schalten den Lauf auf „vorschlag“ (Runde 1, Befund 10). */
  async function selbstabschaltung() {
    const jetzt = Date.now(); const w1a = new Date(jetzt - 7 * 86400000).toISOString(), w2a = new Date(jetzt - 14 * 86400000).toISOString();
    /* Runde 2, Befund 7: eine Rücknahme zählt zur Woche ihrer Erledigung (Kohorte), nicht zur Woche der Rücknahme. */
    const [er, rz] = await Promise.all([
      admin.from('hh_vorhaben_verlauf').select('id,created_at').eq('created_by', 'lauf').eq('art', 'system').like('text', 'Punkt erledigt:%').gte('created_at', w2a),
      admin.from('hh_vorhaben_verlauf').select('source_ref').like('source_ref', 'rueckgaengig:lauf:%').gte('created_at', w2a),
    ]);
    const zurueckIds = new Set(((rz.data || []) as Any[]).map((x: Any) => String(x.source_ref).replace('rueckgaengig:lauf:', '')));
    const w1 = { erledigt: 0, zurueck: 0 }, w2 = { erledigt: 0, zurueck: 0 };
    for (const x of (er.data || []) as Any[]) { const w = x.created_at >= w1a ? w1 : w2; w.erledigt++; if (zurueckIds.has(x.id)) w.zurueck++; }
    if (abschaltungFaellig(w1, w2)) {
      const grund = `Selbstabschaltung ${heuteBerlin()}: diese Woche ${w1.erledigt} Lauf-Erledigungen, ${w1.zurueck} zurückgenommen; Vorwoche ${w2.erledigt} und ${w2.zurueck}. Beide unter 50 % bleibend, Modus auf vorschlag.`;
      await admin.from('hh_lauf_einstellungen').update({ modus: 'vorschlag', abbruch_grund: grund, updated_at: new Date().toISOString() }).eq('id', 1);
      const stempel = heuteBerlin() + ':' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
      await schreibe('hh_lauf_protokoll', { run_id: 'abschaltung:' + stempel, modus: 'vorschlag', quelle_art: 'system', quelle_ref: 'abschaltung:' + stempel, stufe: 'keine', aktion: 'nichts', beleg: grund.slice(0, 600), ausgefuehrt: true }, 'schluessel');
      await schreibe('gfweekly_news', { kind: 'ticker', source_url: '', title: 'Lauf auf Vorschlag zurückgestellt', body: grund, who: 'Lauf', source: 'notiz', relevance: 'hoch', source_ref: 'lauf:abschaltung:' + stempel, happened_at: new Date().toISOString(), status: 'neu' }, 'source_ref');
      return { abgeschaltet: true, w1, w2 };
    }
    return { abgeschaltet: false, w1, w2 };
  }

  /* Rückkehr-Brief: am Morgen einer Rückkehr (status rueckkehr oder bis = heute) aus rueckkehr_lage in fünf bis acht Sätzen, nur wenn leer. */
  async function rueckkehrBriefe(modell: string) {
    if (!deps.rueckkehrLage) return null;
    const heute = heuteBerlin();
    const { data: abs } = await admin.from('gfweekly_absences').select('id,person,status,bis,note_rueckkehr,test').or(`status.eq.rueckkehr,bis.eq.${heute}`).in('status', ['aktiv', 'rueckkehr']).is('note_rueckkehr', null);
    const aus: Any[] = [];
    for (const a of (abs || []) as Any[]) {
      if (a.test) continue;
      const lage = await deps.rueckkehrLage({ absence_id: a.id });
      const kurz = { person: lage.person, von: lage.von, bis: lage.bis, zaehler: lage.zaehler, phasen: (lage.phasen || []).map((p: Any) => ({ phase: p.phase, entschieden: p.entschieden.slice(0, 8).map((x: Any) => ({ text: x.text, ergebnis: x.ergebnis, wer: x.wer, vorhaben: x.vorhaben })), bewegt: p.bewegt.slice(0, 6).map((x: Any) => ({ title: x.title, stand: x.stand, anzahl: x.anzahl })), wartet: p.wartet.slice(0, 8).map((x: Any) => ({ text: x.text, wer: x.wer, vorhaben: x.vorhaben })) })) };
      const key = Deno.env.get('ANTHROPIC_API_KEY') || ''; if (!key) break;
      const body = { model: modell, max_tokens: 700, system: 'Du schreibst für die zurückkehrende Person der Geschäftsführung der Wilde Möhre GmbH einen Absatz von fünf bis acht Sätzen: je Phase (Launch, Formatpartner, Systembau, Weiteres) was entschieden wurde, was sich bewegt hat, was auf sie wartet; nenne Vorhaben beim Namen, keine Bewertungen von Menschen, nichts Privates, keine Gedankenstriche, Deutsch, Du-Ansprache mit Vornamen.', messages: [{ role: 'user', content: JSON.stringify(kurz) }] };
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      const text = (d.content || []).filter((c: Any) => c.type === 'text').map((c: Any) => c.text).join('\n').trim();
      if (res.ok && text && !LAUF_VERTRAULICH.test(text)) {
        await admin.from('gfweekly_absences').update({ note_rueckkehr: text.slice(0, 4000), updated_at: new Date().toISOString() }).eq('id', a.id).is('note_rueckkehr', null);
        aus.push({ absence_id: a.id, person: a.person, geschrieben: true });
      } else aus.push({ absence_id: a.id, person: a.person, geschrieben: false, grund: d?.error?.message || 'leer oder vertraulich' });
    }
    return aus;
  }

  /* Rückblick auswerten: sichere Treffer gegen die Wirklichkeit (von Hand erledigte Punkte im Zeitraum). */
  async function retroAuswertung(t: Any) {
    const von = tag(t.von) || heuteBerlin(); const bis = tag(t.bis) || heuteBerlin(); const run = txt(t.run_id, 80) || 'retro';
    const [pr, pk] = await Promise.all([
      admin.from('hh_lauf_protokoll').select('punkt_id,vorhaben_id,stufe,aktion,beleg,quelle_ref,created_at,quelle_at').like('run_id', run + '%'),
      admin.from('hh_vorhaben_punkte').select('id,titel,erledigt,erledigt_at,erledigt_by,vorhaben_id').eq('erledigt', true).gte('erledigt_at', von + 'T00:00:00+02:00').lte('erledigt_at', bis + 'T23:59:59+00:00'),
    ]);
    for (const r of [pr, pk]) if (r.error) throw r.error;
    const P = (pr.data || []) as Any[]; const hand = ((pk.data || []) as Any[]).filter(p => !/^lauf$/i.test(p.erledigt_by || '') && berlinTag(p.erledigt_at) >= von && berlinTag(p.erledigt_at) <= bis);   // Berliner Tag entscheidet
    const sicher = P.filter(x => x.stufe === 'sicher' && x.punkt_id);
    const handIds = new Set(hand.map(p => p.id));
    const treffer = sicher.filter(x => handIds.has(x.punkt_id)).length;
    const offen = sicher.filter(x => !handIds.has(x.punkt_id));
    const { data: nochOffen } = offen.length ? await admin.from('hh_vorhaben_punkte').select('id,erledigt').in('id', offen.map(x => x.punkt_id)) : { data: [] };
    const fehlalarm = ((nochOffen || []) as Any[]).filter(p => !p.erledigt).length;
    const verpasst = hand.filter(p => !sicher.some(x => x.punkt_id === p.id)).length;
    const wahrsch = P.filter(x => x.stufe === 'wahrscheinlich').length;
    const jeTag: Record<string, number> = {}; for (const x of P) if (x.aktion === 'vorschlag' || x.aktion === 'kandidat') { const d = berlinTag(x.quelle_at || x.created_at); jeTag[d] = (jeTag[d] || 0) + 1; }   // Quellentag, nicht Prüftag (Runde 3, Befund 5)
    const tage = Math.max(1, Math.round((Date.parse(bis) - Date.parse(von)) / 86400000) + 1);
    const sichtungen = Object.values(jeTag).reduce((a, b) => a + b, 0);
    return { run_id: run, von, bis, geprueft: P.length, sicher: sicher.length, treffer, fehlalarm, unentschieden: sicher.length - treffer - fehlalarm, verpasst_von_hand_erledigt: verpasst, wahrscheinlich: wahrsch, unklar: P.filter(x => x.stufe === 'unklar').length,
      praezision: sicher.length ? Math.round(100 * treffer / Math.max(1, treffer + fehlalarm)) : null, sichtungen_je_tag: Math.round(10 * sichtungen / tage) / 10, sichtungen_max_tag: Math.max(0, ...Object.values(jeTag)), hand_erledigt: hand.length };
  }

  async function einstellungenGet() {
    const e = await einstellungen();
    const seit = new Date(Date.now() - 28 * 86400000).toISOString();
    const [pr, cron] = await Promise.all([
      admin.from('hh_lauf_protokoll').select('run_id,modus,postfach,quelle_art,stufe,aktion,beleg,ausgefuehrt,created_at,punkt_id,vorhaben_id').gte('created_at', seit).order('created_at', { ascending: false }).limit(2000),
      admin.rpc('hh_lauf_cron_steht').then((r: Any) => r, () => ({ data: null })),
    ]);
    if (pr.error) throw pr.error;
    const W: Record<string, Any> = {};
    const woche = (d: string) => { const x = new Date(d); const t0 = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); const tg = t0.getUTCDay() || 7; t0.setUTCDate(t0.getUTCDate() + 4 - tg); const j1 = new Date(Date.UTC(t0.getUTCFullYear(), 0, 1)); return `${t0.getUTCFullYear()}-W${String(Math.ceil(((t0.getTime() - j1.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`; };
    for (const r of (pr.data || []) as Any[]) { if (r.quelle_art === 'system') continue; const w = woche(r.created_at); W[w] = W[w] || { woche: w, geprueft: 0, sicher: 0, wahrscheinlich: 0, unklar: 0, erledigt: 0, vorschlag: 0, kandidat: 0, gedeckelt: 0, gesperrt: 0, fehler: 0 }; W[w].geprueft++; if (W[w][r.stufe] !== undefined) W[w][r.stufe]++; if (W[w][r.aktion] !== undefined) W[w][r.aktion]++; }
    const bilanz = deps.laufBilanz ? await deps.laufBilanz({ wochen: 4 }).catch(() => null) : null;
    const s = bilanz?.summe || {};
    const bleibend = s.erledigt ? Math.round(100 * Math.max(0, s.erledigt - (s.zurueckgenommen || 0)) / s.erledigt) : null;
    const { count: offen } = await admin.from('hh_entscheidungen').select('id', { count: 'exact', head: true }).eq('status', 'offen');
    /* Kriterium d je Berliner Tag: der höchste Tageswert und die Zahl der Tage über dem Deckel (Runde 1, Befund 15). */
    const jeTag: Record<string, number> = {}; for (const r of (pr.data || []) as Any[]) if ((r.aktion === 'vorschlag' || r.aktion === 'kandidat') && r.ausgefuehrt) { const d = berlinTag(r.created_at); jeTag[d] = (jeTag[d] || 0) + 1; }
    const tageWerte = Object.values(jeTag); const sichtMax = tageWerte.length ? Math.max(...tageWerte) : 0; const tageUeber = tageWerte.filter(v => v > (e.deckel_tag || 5)).length;
    const kriterien = [
      { kennung: 'a', text: 'Trefferquote des Laufs mindestens 50 %', wert: bilanz?.trefferquote ?? null, ziel: 50, einheit: '%', ok: bilanz?.trefferquote != null ? bilanz.trefferquote >= 50 : null },
      { kennung: 'b', text: 'Mindestens 70 % der Lauf-Erledigungen bleiben', wert: bleibend, ziel: 70, einheit: '%', ok: bleibend != null ? bleibend >= 70 : null },
      { kennung: 'c', text: 'Entscheidungsliste unter 15 offenen Einträgen', wert: offen || 0, ziel: 15, einheit: '', ok: (offen || 0) < 15 },
      { kennung: 'd', text: `Höchstens ${e.deckel_tag || 5} Sichtungen am Tag (höchster Tag, ${tageUeber} Tage darüber)`, wert: sichtMax, ziel: e.deckel_tag || 5, einheit: '', ok: tageUeber === 0 },
    ];
    return { einstellungen: e, versuche: await versuchLage(), gmail_konfiguriert: !!(Deno.env.get('GOOGLE_SA_JSON') || '').trim(), ki_konfiguriert: !!Deno.env.get('ANTHROPIC_API_KEY'), cron: cron?.data ?? null, wochen: Object.values(W).sort((a: Any, b: Any) => String(b.woche).localeCompare(String(a.woche))), letzte: ((pr.data || []) as Any[]).slice(0, 30), bilanz, kriterien };
  }

  async function gmailProbe(t: Any) {
    const e = await einstellungen();
    const postfach = txt(t.postfach, 120) || e.postfaecher?.[0];
    if (!postfach || !(e.postfaecher || []).includes(postfach)) throw new LaufFehler('postfach nicht erlaubt (nur die eingestellten Postfächer)');
    const d = await gmailGet(postfach, 'threads?maxResults=1&q=' + encodeURIComponent('newer_than:1d'));
    return { postfach, ok: true, threads_24h: Number(d.resultSizeEstimate ?? (d.threads || []).length) };
  }

  async function handle(action: string, t: Any): Promise<Response> {
    try {
      if (action === 'lauf_tick') return json(await tick(t));
      if (action === 'lauf_einstellungen_get') return json(await einstellungenGet());
      if (action === 'lauf_einstellungen_set') { const wer = by(t); const patch: Any = {}; for (const k of ['modus', 'deckel_tag', 'modell']) if (t[k] !== undefined) patch[k] = t[k]; if (!Object.keys(patch).length) throw new LaufFehler('nichts zu ändern'); return json(await rpc('hh_lauf_einstellungen_set', { p_patch: patch, p_by: wer })); }
      if (action === 'lauf_gmail_probe') return json(await gmailProbe(t));
      if (action === 'lauf_retro_auswertung') return json(await retroAuswertung(t));
      return json({ error: 'unbekannte Aktion' }, 404);
    } catch (e) {
      if (e instanceof LaufFehler) return json({ error: e.message }, e.status);
      console.error('lauf', action, e);
      return json({ error: 'Lauf: ' + ((e as Error).message || 'Fehler') }, 500);
    }
  }
  return { handle, tick, einstellungenGet, retroAuswertung };
}
