-- Kompass: atomare Reservierung und begrenzte Wiederholung vor Schreibwirkung.
-- Keine Mailtexte/Betreffzeilen speichern. Kein neuer Zeitplan und keine Modusänderung.
-- Rückweg und Reihenfolge siehe docs/QUELLENANKER-UND-VERSUCHE.md.
set lock_timeout = '10s';

-- Jeder Versuch bleibt prüfbar; bestehende Quellen- und Wirkungskennungen bleiben gleich.
alter table public.hh_lauf_protokoll add column versuch int not null default 0 check (versuch between 0 and 3);
alter table public.hh_lauf_protokoll drop column schluessel;
alter table public.hh_lauf_protokoll add column schluessel text generated always as
  (quelle_ref || ':' || coalesce(punkt_id::text, '-') || ':' || modus || ':' || versuch::text) stored;
create unique index hh_lauf_protokoll_schluessel on public.hh_lauf_protokoll (schluessel);

create table public.hh_lauf_versuche (
  postfach text not null,
  quelle_ref text not null check (length(quelle_ref) between 1 and 200),
  modus text not null check (modus in ('vorschlag', 'live')),
  quelle jsonb not null check (jsonb_typeof(quelle) = 'object' and octet_length(quelle::text) <= 2500),
  status text not null default 'bereit' check (status in ('bereit','bearbeitung','wiederholen','wirkung_offen','erschoepft','gedeckelt','fertig')),
  phase text not null default 'analyse' check (phase in ('analyse','schreiben')),
  versuche int not null default 0 check (versuche between 0 and 3),
  token uuid,
  lease_bis timestamptz,
  naechster_versuch timestamptz,
  updated_at timestamptz not null default now(),
  primary key (postfach, quelle_ref, modus),
  unique (quelle_ref, modus)
);
create index hh_lauf_versuche_offen on public.hh_lauf_versuche (postfach, modus, naechster_versuch, updated_at)
  where status in ('wiederholen','bearbeitung');
alter table public.hh_lauf_versuche enable row level security;
revoke all on public.hh_lauf_versuche from public, anon, authenticated;
grant select, insert, update, delete on public.hh_lauf_versuche to service_role;
comment on table public.hh_lauf_versuche is 'Drei Versuche vor Schreibwirkung; Schreibausgang unklar bleibt zur Klärung offen. Nur Quellenkennungen und Hash, keine Inhalte. Altfälle werden nicht automatisch wiederaufgenommen.';

create function public.hh_lauf_versuch_start(p_postfach text, p_ref text, p_modus text, p_quelle jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $fn$
declare v public.hh_lauf_versuche; e public.hh_lauf_einstellungen; alt boolean;
begin
  select * into e from public.hh_lauf_einstellungen where id = 1;
  if coalesce(p_modus,'') not in ('vorschlag','live') or p_modus is distinct from e.modus or
     (p_postfach <> 'fixtures' and not (p_postfach = any(e.postfaecher))) then
    raise exception 'Laufmodus oder Postfach nicht erlaubt' using errcode = 'PT400';
  end if;
  if jsonb_typeof(p_quelle) is distinct from 'object' or coalesce(p_quelle->>'art','') not in ('mail','plattform')
     or coalesce(p_quelle->>'hash','') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_quelle->'fixture') is distinct from 'boolean'
     or exists (select 1 from jsonb_object_keys(p_quelle) k where k not in
       ('art','fixture','thread_id','message_id','datum','hash','feed_tabelle','platform','ref_table','ref_id'))
     or exists (select 1 from jsonb_each(p_quelle) j where j.key <> 'fixture' and jsonb_typeof(j.value) <> 'string') then
    raise exception 'Unzulässige Quellenmetadaten' using errcode = 'PT400';
  end if;
  insert into public.hh_lauf_versuche(postfach,quelle_ref,modus,quelle)
    values (p_postfach,p_ref,p_modus,p_quelle) on conflict do nothing;
  select * into v from public.hh_lauf_versuche where postfach=p_postfach and quelle_ref=p_ref and modus=p_modus for update;
  if not found then return jsonb_build_object('reserviert',false); end if;
  if v.quelle is distinct from p_quelle then raise exception 'Quellfassung verändert' using errcode='PT409'; end if;
  if exists(select 1 from public.hh_lauf_protokoll p where p.quelle_ref=p_ref and p.ausgefuehrt) then
    update public.hh_lauf_versuche set status='fertig',token=null,lease_bis=null,updated_at=now()
      where postfach=p_postfach and quelle_ref=p_ref and modus=p_modus;
    return jsonb_build_object('reserviert',false);
  end if;
  if v.status = 'bereit' then
    -- Alte Protokollfehler verraten die damalige Schreibphase nicht. Konservativ stoppen.
    if exists (select 1 from public.hh_lauf_protokoll p where p.quelle_ref=p_ref and (p.ausgefuehrt or p.modus=p_modus)) then
      select exists(select 1 from public.hh_lauf_protokoll p where p.quelle_ref=p_ref and p.modus=p_modus and p.aktion='fehler' and not p.ausgefuehrt) into alt;
      update public.hh_lauf_versuche set status=case when alt then 'wirkung_offen' else 'fertig' end,updated_at=now()
        where postfach=p_postfach and quelle_ref=p_ref and modus=p_modus;
      return jsonb_build_object('reserviert',false);
    end if;
  elsif v.status='bearbeitung' then
    if v.lease_bis > now() then return jsonb_build_object('reserviert',false); end if;
    if v.phase='schreiben' then
      update public.hh_lauf_versuche set status='wirkung_offen',token=null,lease_bis=null,updated_at=now()
        where postfach=p_postfach and quelle_ref=p_ref and modus=p_modus;
      return jsonb_build_object('reserviert',false);
    end if;
  elsif v.status <> 'wiederholen' or v.naechster_versuch > now() then
    return jsonb_build_object('reserviert',false);
  end if;
  if v.versuche >= 3 then
    update public.hh_lauf_versuche set status='erschoepft',token=null,lease_bis=null,updated_at=now()
      where postfach=p_postfach and quelle_ref=p_ref and modus=p_modus;
    return jsonb_build_object('reserviert',false);
  end if;
  update public.hh_lauf_versuche set status='bearbeitung',phase='analyse',versuche=versuche+1,
    token=gen_random_uuid(),lease_bis=now()+interval '10 minutes',naechster_versuch=null,updated_at=now()
    where postfach=p_postfach and quelle_ref=p_ref and modus=p_modus returning * into v;
  return jsonb_build_object('reserviert',true,'token',v.token,'versuch',v.versuche);
end $fn$;

create function public.hh_lauf_versuch_schreiben(p_token uuid)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $fn$
begin
  update public.hh_lauf_versuche v set phase='schreiben',updated_at=now()
    where token=p_token and status='bearbeitung' and lease_bis>now()
      and exists(select 1 from public.hh_lauf_einstellungen e where e.id=1 and e.modus=v.modus);
  if not found then raise exception 'Versuch oder Laufmodus nicht mehr gültig' using errcode='PT409'; end if;
end $fn$;

create function public.hh_lauf_versuch_ende(p_token uuid, p_ergebnis text)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $fn$
declare v public.hh_lauf_versuche;
begin
  select * into v from public.hh_lauf_versuche where token=p_token and status='bearbeitung' for update;
  if not found then raise exception 'Versuch nicht mehr gültig' using errcode='PT409'; end if;
  if coalesce(p_ergebnis,'') not in ('fertig','fehler','gedeckelt') then raise exception 'Ergebnis ungültig' using errcode='PT400'; end if;
  update public.hh_lauf_versuche set status=case
      when p_ergebnis='fehler' and v.phase='schreiben' then 'wirkung_offen'
      when p_ergebnis='fehler' and v.versuche>=3 then 'erschoepft'
      when p_ergebnis='fehler' then 'wiederholen'
      else p_ergebnis end,
    naechster_versuch=case when p_ergebnis='fehler' and v.phase='analyse' and v.versuche<3 then now()+interval '15 minutes' else null end,
    token=null,lease_bis=null,updated_at=now() where token=p_token;
end $fn$;

create function public.hh_lauf_versuch_offen(p_postfach text, p_modus text, p_limit int)
returns setof public.hh_lauf_versuche language sql stable security invoker set search_path = pg_catalog, public as $fn$
  select v.* from public.hh_lauf_versuche v
  join public.hh_lauf_einstellungen e on e.id=1 and e.modus=v.modus
  where v.postfach=p_postfach and v.modus=p_modus and v.postfach=any(e.postfaecher)
    and v.quelle->>'fixture'='false'
    and ((v.status='wiederholen' and v.naechster_versuch<=now()) or (v.status='bearbeitung' and v.lease_bis<=now()))
  order by v.updated_at limit greatest(0,least(coalesce(p_limit,0),50));
$fn$;

revoke all on function public.hh_lauf_versuch_start(text,text,text,jsonb),public.hh_lauf_versuch_schreiben(uuid),
  public.hh_lauf_versuch_ende(uuid,text),public.hh_lauf_versuch_offen(text,text,int) from public,anon,authenticated;
grant execute on function public.hh_lauf_versuch_start(text,text,text,jsonb),public.hh_lauf_versuch_schreiben(uuid),
  public.hh_lauf_versuch_ende(uuid,text),public.hh_lauf_versuch_offen(text,text,int) to service_role;
