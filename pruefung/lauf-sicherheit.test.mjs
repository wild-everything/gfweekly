/* Echte PostgreSQL-Funktionen in PGlite; synthetische Quellen und KI-Antworten.
   Kein Produktionszugriff, kein Secret, kein kostenpflichtiger Modellaufruf.
   PGLITE_MODUL=/absolut/node_modules/@electric-sql/pglite/dist/index.js node --test pruefung/lauf-sicherheit.test.mjs */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { laufModul, belegVerankert } from '../supabase/functions/gfweekly/lauf.ts';
const { PGlite } = await import(process.env.PGLITE_MODUL || '@electric-sql/pglite');
const db = new PGlite();
after(() => db.close());
const sql = async (q, p = []) => (await db.query(q, p)).rows;
const migration = name => fs.readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(migration('20261026120000_stufe3_lauf').split('-- Einstellungen ändern:')[0]);
await db.exec(`
  create table hh_vorhaben(id uuid primary key,slug text,title text,status text,phase text,fokus text,ball text,ball_name text,stand text,naechster_schritt text,frist date,sort int);
  create table hh_vorhaben_punkte(id uuid primary key,vorhaben_id uuid,titel text,stand text,wer text,frist date,erledigt boolean default false,erledigt_at timestamptz,erledigt_by text,updated_at timestamptz);
  create table hh_vorhaben_verlauf(id uuid primary key default gen_random_uuid(),vorhaben_id uuid,punkt_id uuid,art text,wer text,text text,tag text,status text,created_by text,source_ref text unique,source_url text,happened_at timestamptz,created_at timestamptz default now());
  create table gfweekly_news(kind text,title text,body text,who text,source text,source_title text,source_url text,source_ref text unique,happened_at timestamptz,status text,relevance text,gate text,gate_frist date,vorhaben_vorschlag uuid,run_id text,created_at timestamptz default now());
  create table hh_feed_partner(happened_at timestamptz,platform text,kind text,title text,body text,ref_table text,ref_id text,url text,who text);
  create table hh_feed_habitate(like hh_feed_partner);
  alter table hh_lauf_cursor add column rest_bis timestamptz;
  alter table hh_lauf_protokoll add column quelle_at timestamptz;
`);
const toggle = migration('20261003172105_hh_vorhaben_v31a_transaktionen');
await db.exec(toggle.slice(toggle.indexOf('create or replace function public.hh_punkt_toggle'), toggle.indexOf('$fn$;', toggle.indexOf('create or replace function public.hh_punkt_toggle')) + 5));
const runde1 = migration('20261026130000_stufe3_runde1');
await db.exec(runde1.slice(runde1.indexOf('\nalter table') + 1, runde1.indexOf('create or replace function public.hh_lauf_cron_steht')));
const basis = migration('20261026120000_stufe3_lauf');
await db.exec(basis.slice(basis.indexOf('create or replace function public.hh_lauf_sichtung'), basis.indexOf('-- Zeitplan zurücklesen')));
await db.exec(migration('20261102103454_lauf_quellenanker_versuche'));

const vh = '00000000-0000-0000-0000-000000000001', pk = '00000000-0000-0000-0000-000000000002';
const box = 'alex@example.org', datum = '2026-10-24T10:00:00.000Z';
const quelle = { art:'mail',fixture:false,thread_id:'thread',message_id:'m1',datum,hash:'a'.repeat(64),feed_tabelle:'',platform:'',ref_table:'',ref_id:'' };
const start = async (ref='mail:thread:m1', q=quelle, modus='live', postfach=box) => (await sql('select hh_lauf_versuch_start($1,$2,$3,$4) as v',[postfach,ref,modus,q]))[0].v;
const ende = (token, ergebnis='fehler') => sql('select hh_lauf_versuch_ende($1,$2)',[token,ergebnis]);
const schreiben = token => sql('select hh_lauf_versuch_schreiben($1)',[token]);
const stand = async (ref='mail:thread:m1') => (await sql('select * from hh_lauf_versuche where quelle_ref=$1',[ref]))[0];
const offen = async () => sql('select * from hh_lauf_versuch_offen($1,$2,50)',[box,'live']);
const faellig = () => sql("update hh_lauf_versuche set naechster_versuch=now()-interval '1 minute',lease_bis=now()-interval '1 minute'");
async function reset(modus='live', title='Nordlicht (Test)') {
  await db.exec('truncate hh_lauf_versuche,hh_lauf_protokoll,hh_lauf_cursor,hh_lauf_tag,hh_vorhaben,hh_vorhaben_punkte,hh_vorhaben_verlauf,gfweekly_news,hh_feed_partner,hh_feed_habitate;');
  await sql('update hh_lauf_einstellungen set modus=$1,postfaecher=$2,deckel_tag=5,letzter_fehler=null',[modus,[box]]);
  await sql("insert into hh_vorhaben(id,slug,title,status) values($1,'nordlicht',$2,'aktiv')",[vh,title]);
  await sql("insert into hh_vorhaben_punkte(id,vorhaben_id,titel,wer) values($1,$2,'Vertrag Nordlicht unterschreiben','Alex')",[pk,vh]);
}

const key=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await webcrypto.subtle.exportKey('pkcs8',key.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
const env={ANTHROPIC_API_KEY:'synthetic',GOOGLE_SA_JSON:JSON.stringify({client_email:'test@example.org',private_key:pem})};

test('Quellenanker: erfundene Daten und Beträge, auch neben einem richtigen Namen, reichen nicht',()=>{
  const q={betreff:'Nordlicht Vertrag',text:'Am 24.10.2026 sind 1.200,50 Euro eingegangen.'};
  assert.equal(belegVerankert('Zahlung von 1.200 Euro am 24.10.2026 bestätigt.',{text:'x'}),false);
  assert.equal(belegVerankert('Nordlicht bestätigt 2.000 Euro am 24.10.2026.',q),false);
  assert.equal(belegVerankert('Nordlicht bestätigt 1.200,50 Euro am 25.10.2026.',q),false);
  assert.equal(belegVerankert('Nordlicht bestätigt 1.200,50 Euro am 24.10.2026 und 25.10.2026.',q),false);
  assert.equal(belegVerankert('Nordlicht bestätigt 1.200,50 Euro am 2026-10-24.',q),true);
  assert.equal(belegVerankert('Nordlicht bestätigt 1200.50 EUR am 24.10.26.',q),true);
  assert.equal(belegVerankert('Nordlicht bestätigt € 1 200,50 am 24.10.2026.',q),true);
  assert.equal(belegVerankert('Nordlicht bestätigt € 2.000 am 24.10.2026.',q),false);
  assert.equal(belegVerankert('Nordlicht bestätigt 1 200 Euro.',{text:'Nordlicht bestätigt 200 Euro.'}),false);
  assert.equal(belegVerankert('Nordlicht bestätigt den unterschriebenen Vertrag.',q),true);
  assert.equal(belegVerankert('Zahlung am 31.02.2026 eingegangen.',{text:'31.02.2026'}),false);
  assert.equal(belegVerankert('Die Angelegenheit ist jetzt vollständig abgeschlossen.',q),false);
});
test('SQL: Reservierung atomar, Wiederholung erst nach Wartezeit, maximal drei Versuche',async()=>{
  await reset();
  const [a,b]=await Promise.all([start(),start()]);
  assert.equal([a,b].filter(x=>x.reserviert).length,1);
  let v=a.reserviert?a:b;
  for(let n=1;n<=3;n++) {
    assert.equal(v.versuch,n); await ende(v.token);
    assert.equal((await stand()).status,n===3?'erschoepft':'wiederholen');
    assert.equal((await start()).reserviert,false);
    assert.equal((await offen()).length,0);
    await faellig(); v=await start();
  }
  assert.equal(v.reserviert,false);
  assert.equal((await stand()).versuche,3);
});
test('SQL: Absturz vor Schreiben wiederholbar; abgelaufener Token darf nicht schreiben',async()=>{
  await reset(); const a=await start(); await faellig();
  assert.equal((await offen()).length,1);
  const b=await start(); assert.equal(b.versuch,2);
  await assert.rejects(schreiben(a.token),/nicht mehr gültig/);
  await assert.rejects(ende(a.token),/nicht mehr gültig/);
  await ende(b.token,'fertig'); assert.equal((await start()).reserviert,false);
});
test('SQL: Fehler und Absturz nach Schreibbeginn bleiben offen; kein automatischer Neuversuch',async()=>{
  for(const absturz of [false,true]) {
    await reset(); const a=await start(); await schreiben(a.token);
    if(absturz) await faellig(); else await ende(a.token);
    assert.equal((await start()).reserviert,false);
    assert.equal((await stand()).status,'wirkung_offen');
    assert.equal((await offen()).length,0);
  }
});
test('SQL: aus, fremdes Postfach, Moduswechsel und zusätzliche Inhaltsfelder werden abgelehnt',async()=>{
  await reset('aus'); await assert.rejects(start(),/nicht erlaubt/);
  await reset(); await assert.rejects(start('x',quelle,'live','fremd@example.org'),/nicht erlaubt/);
  for(const q of [{...quelle,text:'privater Mailtext'},{...quelle,hash:''},{fixture:false,hash:quelle.hash}]) await assert.rejects(start('x',q),/Quellenmetadaten/);
  const a=await start(); await sql("update hh_lauf_einstellungen set modus='vorschlag'");
  await assert.rejects(schreiben(a.token),/nicht mehr gültig/);
  assert.equal((await offen()).length,0);
});
test('SQL: Altfälle, ausgeführte Quellen, geänderte Fassungen, Fixtures und Tagesdeckel',async()=>{
  await reset();
  await sql("insert into hh_lauf_protokoll(run_id,modus,quelle_art,quelle_ref,stufe,aktion) values('alt','live','mail','alt','keine','fehler')");
  assert.equal((await start('alt')).reserviert,false); assert.equal((await stand('alt')).status,'wirkung_offen');
  const a=await start(); await ende(a.token); await faellig();
  await assert.rejects(start(undefined,{...quelle,hash:'b'.repeat(64)}),/verändert/);
  await sql("insert into hh_lauf_protokoll(run_id,modus,quelle_art,quelle_ref,stufe,aktion,ausgefuehrt) values('vorher','vorschlag','mail','mail:thread:m1','sicher','vorschlag',true)");
  assert.equal((await start()).reserviert,false);
  const f=await start('fixture',{...quelle,fixture:true}); await ende(f.token); await faellig();
  assert.equal((await offen()).length,0);
  const d=await start('deckel'); await schreiben(d.token); await ende(d.token,'gedeckelt'); await faellig();
  assert.equal((await start('deckel')).reserviert,false); assert.equal((await stand('deckel')).status,'gedeckelt');
});
test('SQL: RLS und Funktionsrechte erlauben weder anon noch authenticated Zugriff',async()=>{
  await reset();
  assert.equal((await sql("select relrowsecurity as r from pg_class where oid='hh_lauf_versuche'::regclass"))[0].r,true);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(sql('select * from hh_lauf_versuche'),/permission denied/);
      await assert.rejects(start(),/permission denied/);
      await assert.rejects(offen(),/permission denied/);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { assert.equal((await start()).reserviert,true); } finally { await db.exec('reset role'); }
});
test('SQL: Erledigung und Beleg bleiben atomar; bereits erledigt und zurückgenommen werden abgelehnt',async()=>{
  await reset();
  await db.exec("alter table hh_vorhaben_verlauf add constraint test_beleg_fehler check(text <> 'ABSICHTLICHER FEHLER')");
  try {
    await assert.rejects(sql("select hh_lauf_erledigt($1,'ref','ABSICHTLICHER FEHLER',null,now(),'mail')",[pk]),/test_beleg_fehler/);
    assert.equal((await sql('select erledigt from hh_vorhaben_punkte'))[0].erledigt,false);
    assert.equal((await sql('select count(*)::int n from hh_vorhaben_verlauf'))[0].n,0);
  } finally {await db.exec('alter table hh_vorhaben_verlauf drop constraint test_beleg_fehler');}
  await sql("insert into hh_vorhaben_verlauf(punkt_id,source_ref) values($1,'rueckgaengig:lauf:test')",[pk]);
  await assert.rejects(sql("select hh_lauf_erledigt($1,'ref','Beleg',null,now(),'mail')",[pk]),/zurückgenommen/);
  await sql('update hh_vorhaben_punkte set erledigt=true');
  await assert.rejects(sql("select hh_lauf_erledigt($1,'ref','Beleg',null,now(),'mail')",[pk]),/schon erledigt/);
});

// Kleine PostgREST-Fassade über dieselbe PostgreSQL-DB. Kein Nachbau der Versuchszustände.
function adminMitFehler(hook=()=>null) {
  const calls=[];
  const id=x=>{assert.match(x,/^[a-z_][a-z_0-9]*$/);return '"'+x+'"';};
  return {calls,
    async rpc(name,args) {
      calls.push(name);
      try {
        const before=hook(name,'vorher'); if(before) throw Error(before);
        const vals=Object.values(args), keys=Object.keys(args);
        const rows=await sql(`select * from ${id(name)}(${keys.map((k,i)=>`${id(k)} => $${i+1}`).join(',')})`,vals);
        const after=hook(name,'nachher'); if(after) throw Error(after);
        return {data:name==='hh_lauf_versuch_offen'?rows:rows[0]?.[name]};
      } catch(error) {return {error};}
    },
    from(table) {
      const filters=[],params=[]; let order='',limit='',single=false,head=false,mode='select',row,conflict,ignore;
      const add=(col,op,v)=>{params.push(v);filters.push(`${id(col)} ${op} $${params.length}`);};
      const b={
        select(_cols,opts={}){head=opts.head;return b;},eq(c,v){add(c,'=',v);return b;},gt(c,v){add(c,'>',v);return b;},gte(c,v){add(c,'>=',v);return b;},lte(c,v){add(c,'<=',v);return b;},like(c,v){add(c,'like',v);return b;},
        in(c,v){params.push(v);filters.push(`${id(c)}=any($${params.length})`);return b;},
        order(c,o={}){order=` order by ${id(c)} ${o.ascending===false?'desc':'asc'}`;return b;},limit(n){limit=` limit ${Number(n)}`;return b;},maybeSingle(){single=true;return b;},
        upsert(r,o){mode='upsert';row=r;conflict=o.onConflict;ignore=o.ignoreDuplicates;return b;},update(r){mode='update';row=r;return b;},
        async then(resolve,reject) {
          try {
            const where=filters.length?' where '+filters.join(' and '):'';
            let q,values;
            if(mode==='select') {q=`select ${head?'count(*)::int as n':'*'} from ${id(table)}${where}${head?'':order+limit}`;values=params;}
            else if(mode==='upsert') {
              const keys=Object.keys(row); values=Object.values(row);
              q=`insert into ${id(table)}(${keys.map(id)}) values(${keys.map((_,i)=>'$'+(i+1))}) on conflict(${id(conflict)}) do ${ignore?'nothing':'update set '+keys.map(k=>`${id(k)}=excluded.${id(k)}`).join(',')}`;
            } else {
              const keys=Object.keys(row); values=[...params,...Object.values(row)];
              q=`update ${id(table)} set ${keys.map((k,i)=>`${id(k)}=$${params.length+i+1}`)}${where}`;
            }
            calls.push(table+':'+mode); const data=await sql(q,values);
            resolve({data:head?null:single?data[0]||null:data,count:head?data[0].n:null});
          } catch(error) {resolve({error});}
        }
      };return b;
    }
  };
}
function message(id,text='Nordlicht bestätigt den unterschriebenen Vertrag.',time=datum) {
  return {id,internalDate:String(Date.parse(time)),payload:{mimeType:'text/plain',body:{data:Buffer.from(text).toString('base64url')},headers:[{name:'Subject',value:'Nordlicht Vertrag'},{name:'From',value:'partner@example.org'},{name:'To',value:box},{name:'Date',value:time}]},labelIds:[]};
}
const fixture=(over={})=>({thread_id:'thread',message_id:'m1',von:'partner@example.org',an:box,betreff:'Nordlicht Vertrag',datum,text:'Nordlicht bestätigt den unterschriebenen Vertrag.',...over});
async function tickLabor({antwort={},modellFehler=false,hook,threads=[{id:'thread',messages:[message('m1')]}],...opts}={}) {
  const admin=adminMitFehler(hook),prompts=[],requests=[],realFetch=globalThis.fetch,realDeno=globalThis.Deno;
  globalThis.Deno={env:{get:k=>env[k]}};
  globalThis.fetch=async(url,init)=>{
    requests.push(String(url));
    if(String(url).startsWith('https://oauth2.googleapis.com/')) return Response.json({access_token:'synthetic',expires_in:3600});
    if(String(url).includes('gmail.googleapis.com')) {
      const u=new URL(url), m=u.pathname.match(/\/threads\/([^/]+)$/);
      if(m) return Response.json(threads.find(t=>t.id===decodeURIComponent(m[1]))||{id:m[1],messages:[]});
      return Response.json({threads:threads.map(t=>({id:t.id}))});
    }
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    prompts.push(JSON.parse(init.body).messages[0].content);
    if(modellFehler) throw Error('synthetic private message must never reach logs');
    return Response.json({content:[{type:'tool_use',input:{vorhaben_slug:'nordlicht',punkt_id:pk,sicherheit:0.95,abschluss_belegt:true,beleg:'Nordlicht bestätigt den unterschriebenen Vertrag.',...antwort}}]});
  };
  try {
    const modul=laufModul({admin,json:(b,s=200)=>Response.json(b,{status:s}),heuteBerlin:()=> '2026-11-02',whoNorm:s=>s});
    const res=await modul.handle('lauf_tick',{postfach:box,batch:1,...opts});
    const data=await res.json(); assert.equal(res.status,200,JSON.stringify(data));
    return {data,calls:admin.calls,prompts,requests};
  } finally {globalThis.fetch=realFetch;globalThis.Deno=realDeno;}
}
test('Integration: aus schreibt nichts; probe schreibt ausschließlich Protokoll; Fixtures schützen echte Vorhaben',async()=>{
  await reset('aus'); const aus=await tickLabor({mails:[fixture()]}); assert.equal(aus.data.uebersprungen,true); assert.deepEqual(aus.calls,['hh_lauf_einstellungen:select']);
  await reset(); const probe=await tickLabor({probe:true,mails:[fixture()]});
  assert.deepEqual(probe.calls.filter(c=>!c.endsWith(':select')),['hh_lauf_protokoll:upsert']);
  assert.equal((await sql('select count(*)::int n from hh_lauf_versuche'))[0].n,0);
  await reset('live','Echtes Vorhaben'); const f=await tickLabor({mails:[fixture()]});
  assert.equal(f.data.zeilen[0].aktion,'uebersprungen'); assert.equal((await sql('select erledigt from hh_vorhaben_punkte'))[0].erledigt,false);
  assert(!f.calls.includes('hh_lauf_erledigt')); assert(!f.calls.includes('hh_lauf_sichtung'));
});
test('Integration: erfundener Betrag verhindert Erledigung, Rücknahme sperrt, Tagesdeckel bleibt wirksam',async()=>{
  await reset(); const unklar=await tickLabor({mails:[fixture()],antwort:{beleg:'Nordlicht bestätigt Zahlung von 2.000 Euro.'}});
  assert.equal(unklar.data.zeilen[0].aktion,'vorschlag'); assert(!unklar.calls.includes('hh_lauf_erledigt'));
  await reset(); await sql("insert into hh_vorhaben_verlauf(punkt_id,source_ref) values($1,'rueckgaengig:lauf:test')",[pk]);
  const sperre=await tickLabor({mails:[fixture()]}); assert.equal(sperre.data.zeilen[0].aktion,'gesperrt');
  await reset(); await sql('update hh_lauf_einstellungen set deckel_tag=0');
  const deckel=await tickLabor({mails:[fixture()],antwort:{sicherheit:0.78,abschluss_belegt:false}});
  assert.equal(deckel.data.zeilen[0].aktion,'gedeckelt'); assert.equal((await stand()).status,'gedeckelt');
  assert.equal((await sql('select count(*)::int n from hh_vorhaben_verlauf'))[0].n,0);
});
test('Integration: Nutzlast kann sich keinen echten Wiederholungsauftrag unterschieben; Einwurf und Vertraulichkeit bleiben geschützt',async()=>{
  await reset('live','Echtes Vorhaben');
  const a=await tickLabor({mails:[fixture({_versuch:{quelle_ref:'mail:thread:m1',quelle}})],modellFehler:true});
  assert.equal(a.data.zusammen.fehler,1); assert.equal((await stand()).quelle.fixture,true);
  assert.equal(a.requests.filter(x=>x.includes('gmail.googleapis.com')).length,0);
  await faellig(); assert.equal((await offen()).length,0);
  await reset(); const b=await tickLabor({mails:[fixture({an:'alex+einwurf@wildemoehre.org'})]});
  assert.equal(b.data.zeilen[0].aktion,'uebersprungen'); assert(!b.calls.includes('hh_lauf_versuch_schreiben'));
  await reset(); const c=await tickLabor({mails:[fixture()],antwort:{beleg:'Nordlicht bestätigt die Diagnose und das Passwort geheim.'}});
  assert.equal(c.data.zeilen[0].aktion,'vorschlag'); assert(!c.calls.includes('hh_lauf_erledigt'));
  assert(!JSON.stringify(await sql('select text from hh_vorhaben_verlauf')).includes('geheim'));
});
test('Integration: KI-Fehler nach Cursorfortschritt wird mit exakt alter Nachricht erfolgreich wiederholt',async()=>{
  await reset(); const a=await tickLabor({modellFehler:true}); assert.equal(a.data.zusammen.fehler,1);
  assert.equal((await stand()).status,'wiederholen'); assert((await sql('select bis_at from hh_lauf_cursor'))[0].bis_at);
  const cursor=(await sql('select * from hh_lauf_cursor'))[0];
  assert(!JSON.stringify(await sql('select beleg from hh_lauf_protokoll')).includes('synthetic private'));
  assert(!('text' in (await stand()).quelle)); assert(!('betreff' in (await stand()).quelle));
  await faellig();
  const b=await tickLabor({threads:[{id:'thread',messages:[message('m1'),message('m2','NEUE NACHRICHT DARF NICHT IN ALTEN VERSUCH','2026-10-25T10:00:00.000Z')]}]});
  assert.equal(b.data.zusammen.erledigt,1); assert.equal((await stand()).versuche,2); assert.equal((await stand()).status,'fertig');
  assert(!b.prompts[0].includes('NEUE NACHRICHT')); assert.equal(b.data.cursor,null);
  assert.deepEqual((await sql('select * from hh_lauf_cursor'))[0],cursor);
  assert.deepEqual((await sql('select aktion from hh_lauf_protokoll order by versuch')).map(x=>x.aktion),['fehler','erledigt']);
});
test('Integration: verlorene Antwort nach bestätigter Schreibwirkung erzeugt keine zweite Wirkung',async()=>{
  await reset();
  const a=await tickLabor({hook:(name,phase)=>name==='hh_lauf_erledigt'&&phase==='nachher'?'connection lost':null});
  assert.equal(a.data.zusammen.fehler,1); assert.equal((await stand()).status,'wirkung_offen');
  assert.equal((await sql('select erledigt from hh_vorhaben_punkte'))[0].erledigt,true);
  const n=(await sql('select count(*)::int n from hh_vorhaben_verlauf'))[0].n;
  await faellig(); const b=await tickLabor(); assert(!b.calls.includes('hh_lauf_erledigt'));
  assert.equal((await sql('select count(*)::int n from hh_vorhaben_verlauf'))[0].n,n);
  assert.match((await sql('select letzter_fehler from hh_lauf_einstellungen'))[0].letzter_fehler,/Offen zur Klärung/);
});
test('Integration: explizites Zeitfenster zieht keine unabhängigen Wiederholungsaufträge hinein',async()=>{
  await reset(); await tickLabor({modellFehler:true}); await faellig();
  const a=await tickLabor({before:'2026-10-01T00:00:00.000Z',threads:[]});
  assert.equal(a.prompts.length,0); assert.equal(a.data.cursor,null);
  assert.equal((await stand()).versuche,1); assert.equal((await stand()).status,'wiederholen');
});
test('Integration: neue Nachricht in bearbeitetem Thread wird neu geprüft; gesendete Mail erzeugt keinen Kandidaten',async()=>{
  await reset(); await tickLabor({antwort:{sicherheit:0.2,abschluss_belegt:false}});
  const b=await tickLabor({threads:[{id:'thread',messages:[message('m1'),message('m2')]}]});
  assert.equal(b.data.zusammen.geprueft,1); assert.equal(b.data.zeilen[0].ref,'mail:thread:m2');
  await reset(); const c=await tickLabor({mails:[fixture({gesendet:true})],antwort:{punkt_id:null,sicherheit:0.8,abschluss_belegt:false,kandidat:{titel:'Zusatzoption entscheiden'}}});
  assert.equal(c.data.zeilen[0].aktion,'nichts'); assert(!c.calls.includes('hh_lauf_sichtung'));
});
test('Integration: Feedfehler wiederholt denselben Feedstand; veränderte Quellen werden abgewiesen',async()=>{
  await reset();
  await sql("insert into hh_feed_partner values($1,'partner','vertrag','Nordlicht Vertrag','Nordlicht bestätigt den unterschriebenen Vertrag.','partner','p1','https://example.org/quelle','Partner')",[new Date().toISOString()]);
  const a=await tickLabor({threads:[],modellFehler:true}); assert.equal(a.data.zusammen.fehler,1);
  const v=(await sql('select * from hh_lauf_versuche'))[0]; assert.equal(v.quelle.feed_tabelle,'hh_feed_partner');
  await faellig(); await sql("update hh_feed_partner set body='Nachträglich veränderter Inhalt'");
  const b=await tickLabor({threads:[]}); assert.equal(b.prompts.length,0); assert.equal(b.data.zusammen.fehler,1);
  assert.equal((await stand(v.quelle_ref)).versuche,2);
  await faellig(); await sql("update hh_feed_partner set body='Nordlicht bestätigt den unterschriebenen Vertrag.'");
  const c=await tickLabor({threads:[]}); assert.equal(c.data.zusammen.erledigt,1);
  assert.equal((await stand(v.quelle_ref)).status,'fertig'); assert.equal((await stand(v.quelle_ref)).versuche,3);
});
