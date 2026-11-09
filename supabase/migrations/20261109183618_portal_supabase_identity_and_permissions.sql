-- Fictional-only isolated demo schema; never apply to a production project.
create schema if not exists portal_private;
revoke all on schema portal_private from public, anon;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

create table public.portal_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text unique not null check (email like '%@example.invalid'),
 name text not null check (length(name) between 1 and 150),
 role text not null check (role in ('family','cenit','cenepsi','personal','doctor')),
 active boolean not null default true
);
create table public.portal_patients (
 id uuid primary key default gen_random_uuid(), name text not null check (name ~ '(Prueba|Demo)'), birth_date date not null
);
create table public.portal_enrollments (
 patient uuid not null references public.portal_patients, center text not null check (center in ('CENIT','Cenepsi')), primary key(patient,center)
);
create table public.portal_grants (
 id uuid primary key default gen_random_uuid(), account uuid not null references public.portal_profiles,
 patient uuid not null references public.portal_patients,
 manage boolean not null, submit boolean not null, clinical boolean not null,
 verified_by uuid references public.portal_profiles, evidence text not null,
 review_on date, revoked_at timestamptz, unique(account,patient)
);
create table public.portal_requests (
 id uuid primary key default gen_random_uuid(), patient uuid not null references public.portal_patients,
 requester uuid not null references public.portal_profiles,
 center text check(center in ('CENIT','Cenepsi')), reason integer not null check(reason between 0 and 4),
 state text not null check(state in ('Registrada','Pendiente de asignación','Asignada','En revisión administrativa','Pendiente de revisión médica','En revisión médica','Pendiente de información del solicitante','Respondida','Cerrada')),
 priority integer not null check(priority between 0 and 3), rules_version text not null,
 assigned uuid references public.portal_profiles, accepted_by uuid references public.portal_profiles,
 accepted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 due_at timestamptz, recorded_at timestamptz
);
create table public.portal_messages (
 id uuid primary key default gen_random_uuid(), request uuid not null references public.portal_requests,
 author uuid not null references public.portal_profiles, kind text not null check(kind in ('administrative','clinical')),
 body text not null check(length(body) between 1 and 8500), center text, created_at timestamptz not null default now(),
 sequence bigint generated always as identity
);
create table public.portal_message_recipients (
 message uuid references public.portal_messages on delete cascade, account uuid references public.portal_profiles, primary key(message,account)
);
create table public.portal_documents (
 id uuid primary key default gen_random_uuid(), request uuid not null references public.portal_requests,
 series uuid not null, version integer not null check(version>=1), uploader uuid not null references public.portal_profiles,
 center text, clinical boolean not null, filename text not null check(length(filename) between 1 and 120),
 mime text not null check(mime in ('application/pdf','image/png','image/jpeg')), storage_path text unique not null,
 upload_state text not null check(upload_state in ('pending','ready')), approved_by uuid references public.portal_profiles,
 approved_at timestamptz, created_at timestamptz not null default now(), unique(series,version)
);
create table public.portal_document_recipients (
 document uuid references public.portal_documents on delete cascade, account uuid references public.portal_profiles, primary key(document,account)
);
create table portal_private.download_tickets (
 hash text primary key, document uuid not null references public.portal_documents on delete cascade,
 account uuid not null references public.portal_profiles, session_id uuid not null, expires_at timestamptz not null
);
create table public.portal_notifications (
 id uuid primary key default gen_random_uuid(), request uuid not null references public.portal_requests,
 account uuid not null references public.portal_profiles, event uuid not null,
 channel text not null check(channel in ('internal','email-test','secondary-test')),
 status text not null, attempts integer not null default 0, next_at timestamptz, delivered_at timestamptz,
 created_at timestamptz not null default now(), unique(request,account,event,channel)
);
create table public.portal_preferences (account uuid primary key references public.portal_profiles, priorities integer[] not null default array[0,1,2,3]);
create table public.portal_observations (request uuid primary key references public.portal_requests, status text not null default 'not_configured', payload jsonb);
create table public.portal_settings (key text primary key, value jsonb not null);
create table public.portal_rules (version text primary key, config jsonb not null, author uuid references public.portal_profiles, created_at timestamptz not null default now(), change_reason text not null);
create table public.portal_audit (
 seq bigint generated always as identity primary key, actor uuid references public.portal_profiles,
 action text not null, target uuid, at timestamptz not null default now(), detail jsonb not null default '{}'::jsonb
);
create index on public.portal_requests(center,updated_at desc);
create index on public.portal_requests(patient);
create index on public.portal_requests(requester);
create index on public.portal_grants(patient,account);
create index on public.portal_messages(request,sequence);
create index on public.portal_documents(request);
create index on public.portal_notifications(account,created_at desc);
create index on public.portal_audit(target,seq);
create index on portal_private.download_tickets(expires_at);

-- Session revocation is checked against Supabase Auth itself; there is no second user/session database.
create function portal_private.session_user() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.portal_profiles p join auth.sessions s on s.user_id=p.id
 where p.id=(select auth.uid()) and p.active and s.id=nullif((select auth.jwt())->>'session_id','')::uuid
 and (s.not_after is null or s.not_after>now()) and s.created_at>now()-interval '1 hour'
$$;
create function portal_private.actor_role() returns text language sql stable security definer set search_path='' as $$
 select p.role from public.portal_profiles p where p.id=portal_private.session_user()
 and (p.role='family' or (select auth.jwt())->>'aal'='aal2')
$$;
create function portal_private.actor() returns uuid language sql stable security definer set search_path='' as $$
 select case when portal_private.actor_role() is not null then portal_private.session_user() end
$$;
create function portal_private.has_grant(pid uuid, aid uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.portal_grants g where g.patient=pid and g.account=aid and exists(select 1 from public.portal_profiles p where p.id=aid and p.active) and g.revoked_at is null
 and (g.review_on is null or g.review_on>(now() at time zone 'America/Santiago')::date)
 and case permission when 'manage' then g.manage when 'submit' then g.submit when 'clinical' then g.clinical when 'any' then g.manage or g.submit or g.clinical else false end)
$$;
create function portal_private.can_patient(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case portal_private.actor_role()
 when 'doctor' then true when 'personal' then true
 when 'cenit' then exists(select 1 from public.portal_enrollments e where e.patient=pid and e.center='CENIT')
 when 'cenepsi' then exists(select 1 from public.portal_enrollments e where e.patient=pid and e.center='Cenepsi')
 when 'family' then portal_private.has_grant(pid,portal_private.actor(),'any') else false end
$$;
create function portal_private.can_request(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.portal_requests r where r.id=rid and case portal_private.actor_role()
 when 'doctor' then true when 'personal' then true when 'cenit' then r.center='CENIT' when 'cenepsi' then r.center='Cenepsi'
 when 'family' then portal_private.has_grant(r.patient,portal_private.actor(),'manage')
 or (r.requester=portal_private.actor() and portal_private.has_grant(r.patient,portal_private.actor(),'submit'))
 or (portal_private.has_grant(r.patient,portal_private.actor(),'clinical') and
 (exists(select 1 from public.portal_message_recipients mr join public.portal_messages m on m.id=mr.message where m.request=r.id and mr.account=portal_private.actor())
 or exists(select 1 from public.portal_document_recipients dr join public.portal_documents d on d.id=dr.document where d.request=r.id and d.approved_by is not null and dr.account=portal_private.actor())))
 else false end)
$$;
create function portal_private.can_message(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.portal_messages m join public.portal_requests r on r.id=m.request where m.id=mid
 and portal_private.can_request(r.id) and (portal_private.actor_role()='doctor'
 or (m.kind='administrative' and (portal_private.actor_role() in ('personal','family') or m.center=r.center))
 or (portal_private.actor_role()='family' and (m.author=portal_private.actor() or
 (portal_private.has_grant(r.patient,portal_private.actor(),'clinical') and exists(select 1 from public.portal_message_recipients mr where mr.message=m.id and mr.account=portal_private.actor()))))))
$$;
create function portal_private.can_document(did uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.portal_documents d join public.portal_requests r on r.id=d.request where d.id=did
 and d.upload_state='ready' and portal_private.can_request(r.id) and (portal_private.actor_role()='doctor'
 or (portal_private.actor_role() in ('personal','cenit','cenepsi') and not d.clinical and (portal_private.actor_role()='personal' or d.center=r.center))
 or (portal_private.actor_role()='family' and d.approved_by is not null and exists(select 1 from public.portal_document_recipients dr where dr.document=d.id and dr.account=portal_private.actor())
 and portal_private.has_grant(r.patient,portal_private.actor(),case when d.clinical then 'clinical' else 'manage' end))))
$$;

-- Direct REST reads are scoped. Writes occur only through the authenticated, guarded command.
alter table public.portal_profiles enable row level security;
alter table public.portal_patients enable row level security;
alter table public.portal_enrollments enable row level security;
alter table public.portal_grants enable row level security;
alter table public.portal_requests enable row level security;
alter table public.portal_messages enable row level security;
alter table public.portal_message_recipients enable row level security;
alter table public.portal_documents enable row level security;
alter table public.portal_document_recipients enable row level security;
alter table public.portal_notifications enable row level security;
alter table public.portal_preferences enable row level security;
alter table public.portal_observations enable row level security;
alter table public.portal_settings enable row level security;
alter table public.portal_rules enable row level security;
alter table public.portal_audit enable row level security;
alter table portal_private.download_tickets enable row level security;
create policy own_profile on public.portal_profiles for select to authenticated using(id=(select portal_private.session_user()));
create policy patients_scope on public.portal_patients for select to authenticated using(portal_private.can_patient(id));
create policy enrollments_scope on public.portal_enrollments for select to authenticated using(portal_private.can_patient(patient));
create policy grants_scope on public.portal_grants for select to authenticated using(portal_private.actor_role() in ('doctor','personal') or account=(select portal_private.actor()));
create policy requests_scope on public.portal_requests for select to authenticated using(portal_private.can_request(id));
create policy messages_scope on public.portal_messages for select to authenticated using(portal_private.can_message(id));
create policy message_recipients_scope on public.portal_message_recipients for select to authenticated using(portal_private.can_message(message));
create policy documents_scope on public.portal_documents for select to authenticated using(portal_private.can_document(id));
create policy document_recipients_scope on public.portal_document_recipients for select to authenticated using(portal_private.can_document(document));
create policy notifications_scope on public.portal_notifications for select to authenticated using(account=(select portal_private.actor()) and portal_private.can_request(request));
create policy preferences_scope on public.portal_preferences for select to authenticated using(account=(select portal_private.actor()));
create policy observations_scope on public.portal_observations for select to authenticated using(portal_private.actor_role()='doctor');
create policy settings_scope on public.portal_settings for select to authenticated using(portal_private.actor_role()='doctor');
create policy rules_scope on public.portal_rules for select to authenticated using(portal_private.actor_role()='doctor');
create policy audit_scope on public.portal_audit for select to authenticated using(portal_private.actor_role()='doctor');

revoke all on all tables in schema public from anon, authenticated;
grant select on public.portal_profiles,public.portal_patients,public.portal_enrollments,public.portal_grants,public.portal_requests,
 public.portal_messages,public.portal_message_recipients,public.portal_documents,public.portal_document_recipients,
 public.portal_notifications,public.portal_preferences,public.portal_observations,public.portal_settings,public.portal_rules,public.portal_audit to authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

create function portal_private.append_audit(action text, target uuid, detail jsonb default '{}') returns void language sql volatile security definer set search_path='' as $$
 insert into public.portal_audit(actor,action,target,detail) values(portal_private.actor(),action,target,detail)
$$;
create function portal_private.immutable_audit() returns trigger language plpgsql set search_path='' as $$
 begin raise exception using errcode='42501',message='La auditoría no se puede modificar.'; end
$$;
create trigger audit_immutable before update or delete on public.portal_audit for each row execute function portal_private.immutable_audit();
create function portal_private.immutable_document() returns trigger language plpgsql set search_path='' as $$
 begin
 if new.storage_path<>old.storage_path or new.request<>old.request or new.series<>old.series or new.version<>old.version or new.clinical<>old.clinical or new.filename<>old.filename or new.mime<>old.mime then
 raise exception using errcode='42501',message='Se requiere una nueva versión.'; end if; return new;
 end
$$;
create trigger document_version_immutable before update on public.portal_documents for each row execute function portal_private.immutable_document();

create function portal_private.active_coverage(at timestamptz default now()) returns boolean language plpgsql stable security definer set search_path='' as $$
 declare a jsonb; local_at timestamp; closing time;
 begin
 select value into a from public.portal_settings where key='absence';
 if coalesce((a->>'enabled')::boolean,false) and (a->>'until' is null or (a->>'until')::timestamptz>at) then return false; end if;
 local_at:=at at time zone 'America/Santiago'; closing:=case when extract(isodow from local_at) in (6,7) then '13:00'::time else '20:00'::time end;
 return local_at::time>='08:00'::time and local_at::time<closing;
 end
$$;
create function portal_private.classify(body text, reason integer) returns integer language plpgsql stable security definer set search_path='' as $$
 declare c jsonb; t text:=lower(extensions.unaccent(body)); level text; phrase text;
 begin
 select r.config into c from public.portal_rules r join public.portal_settings s on s.key='rules' and r.version=s.value#>>'{}';
 foreach level in array array['red','orange','yellow'] loop
 for phrase in select jsonb_array_elements_text(c->level) loop
 if position(lower(extensions.unaccent(phrase)) in t)>0 then return case level when 'red' then 3 when 'orange' then 2 else 1 end; end if;
 end loop; end loop; return case when reason in (2,3,4) then 1 else 0 end;
 end
$$;
create function portal_private.queue(rid uuid) returns void language plpgsql volatile security definer set search_path='' as $$
 declare r public.portal_requests; p public.portal_profiles; event_id uuid:=gen_random_uuid(); status text;
 begin
 select * into strict r from public.portal_requests where id=rid;
 insert into public.portal_notifications(request,account,event,channel,status) values(rid,r.requester,event_id,'internal','available');
 for p in select * from public.portal_profiles where active and role<>'family' loop
 if p.role not in ('doctor','personal') and not (p.role='cenit' and r.center='CENIT') and not(p.role='cenepsi' and r.center='Cenepsi') then continue; end if;
 if exists(select 1 from public.portal_preferences pref where pref.account=p.id and not(r.priority=any(pref.priorities))) then continue; end if;
 insert into public.portal_notifications(request,account,event,channel,status) values(rid,p.id,event_id,'internal','available');
 if p.role<>'doctor' or (r.priority>=2 and r.accepted_at is null) then
 status:=case when p.role='doctor' and not portal_private.active_coverage() then 'held_coverage' else 'queued_test' end;
 insert into public.portal_notifications(request,account,event,channel,status) values(rid,p.id,event_id,'email-test',status);
 if p.role='doctor' then insert into public.portal_notifications(request,account,event,channel,status) values(rid,p.id,event_id,'secondary-test',status); end if;
 end if; end loop;
 end
$$;
create function portal_private.validate_recipients(pid uuid, audience jsonb, clinical boolean) returns void language plpgsql stable security definer set search_path='' as $$
 declare aid uuid;
 begin
 if jsonb_typeof(audience) is distinct from 'array' or jsonb_array_length(audience)>20 then raise exception using errcode='22023',message='Destinatarios inválidos.'; end if;
 for aid in select jsonb_array_elements_text(audience)::uuid loop
 if not portal_private.has_grant(pid,aid,case when clinical then 'clinical' else 'manage' end) then raise exception using errcode='42501',message='Destinatario sin autorización vigente.'; end if;
 if portal_private.actor_role()='family' and aid<>portal_private.actor() and not portal_private.has_grant(pid,portal_private.actor(),'clinical') then raise exception using errcode='42501',message='No autorizado.'; end if;
 end loop;
 end
$$;

create function portal_private.detail(rid uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
 declare r public.portal_requests; result jsonb;
 begin
 if not portal_private.can_request(rid) then raise exception using errcode='42501',message='Solicitud no disponible.'; end if;
 select * into strict r from public.portal_requests where id=rid;
 perform portal_private.append_audit('request.read',rid);
 result:=to_jsonb(r)||jsonb_build_object('patient_name',(select name from public.portal_patients where id=r.patient),
 'messages',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('author_name',p.name,'author_role',p.role,'audience',coalesce((select jsonb_agg(account) from public.portal_message_recipients where message=m.id),'[]')) order by m.sequence)
 from public.portal_messages m join public.portal_profiles p on p.id=m.author where m.request=rid and portal_private.can_message(m.id)),'[]'),
 'documents',coalesce((select jsonb_agg((to_jsonb(d)-'storage_path')||jsonb_build_object('audience',coalesce((select jsonb_agg(account) from public.portal_document_recipients where document=d.id),'[]')) order by d.created_at,d.version)
 from public.portal_documents d where d.request=rid and portal_private.can_document(d.id)),'[]'),
 'administrativeRecipients',coalesce((select jsonb_agg(jsonb_build_object('account',p.id,'name',p.name)) from public.portal_profiles p where portal_private.has_grant(r.patient,p.id,'manage')),'[]'),
 'recipients',case when portal_private.actor_role()='doctor' or (portal_private.actor_role()='family' and portal_private.has_grant(r.patient,portal_private.actor(),'clinical')) then
 coalesce((select jsonb_agg(jsonb_build_object('account',p.id,'name',p.name,'manage',g.manage,'submit',g.submit,'clinical',g.clinical)) from public.portal_grants g join public.portal_profiles p on p.id=g.account where g.patient=r.patient and portal_private.has_grant(r.patient,g.account,'any')),'[]') else '[]'::jsonb end,
 'timeline',coalesce((select jsonb_agg(case when portal_private.actor_role()='doctor' then to_jsonb(a) else jsonb_build_object('action',a.action,'at',a.at) end order by a.seq) from public.portal_audit a where a.target=rid and a.action not in ('request.read','document.download')),'[]'),
 'notifications',coalesce((select jsonb_agg(to_jsonb(n)-'account'-'event') from public.portal_notifications n where n.request=rid and n.account=portal_private.actor()),'[]'),
 'observation',case when portal_private.actor_role()='doctor' then (select to_jsonb(o) from public.portal_observations o where o.request=rid) else null end,
 'permissions',jsonb_build_object('professional',portal_private.actor_role()<>'family','doctor',portal_private.actor_role()='doctor','clinical',portal_private.actor_role()='doctor' or portal_private.has_grant(r.patient,portal_private.actor(),'clinical')),
 'rules_approved',false);
 return result;
 end
$$;

-- One guarded mutation boundary. SECURITY DEFINER is needed for atomic append-only audit,
-- role-restricted transitions and the outbox, not to bypass an authorization failure.
-- It lives in a non-exposed schema, accepts no actor/role, and rechecks the Auth session.
create function portal_private.dispatch(op text, b jsonb default '{}') returns jsonb language plpgsql volatile security definer set search_path='' as $$
 #variable_conflict use_column
 declare aid uuid:=portal_private.actor(); v_role text:=portal_private.actor_role();
 r public.portal_requests; d public.portal_documents; g public.portal_grants; dest public.portal_profiles;
 rid uuid; mid uuid; did uuid; pid uuid; recipient uuid; audience jsonb:=coalesce(b->'audience','[]');
 body text; current_rules jsonb; priority integer; reason integer; at_time timestamptz:=clock_timestamp();
 ver integer; series_id uuid; token text; ticket portal_private.download_tickets;
 pref jsonb; conf jsonb; n public.portal_notifications; outcome text;
 begin
 if aid is null then raise exception using errcode='42501',message='La sesión requiere verificación y segundo factor profesional.'; end if;
 if op='bootstrap' then
 return jsonb_build_object(
 'account',(select to_jsonb(p)-'active' from public.portal_profiles p where p.id=aid),
 'patients',case when v_role='family' then coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('manage',g.manage,'submit',g.submit,'clinical',g.clinical,'review_on',g.review_on,
 'centers',coalesce((select jsonb_agg(e.center) from public.portal_enrollments e where e.patient=p.id),'[]'),
 'recipients',case when g.clinical then coalesce((select jsonb_agg(jsonb_build_object('account',q.id,'name',q.name)) from public.portal_profiles q where portal_private.has_grant(p.id,q.id,'clinical')),'[]') else '[]'::jsonb end))
 from public.portal_patients p join public.portal_grants g on g.patient=p.id where g.account=aid and portal_private.has_grant(p.id,aid,'any')),'[]') else '[]'::jsonb end,
 'requests',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('patient_name',p.name) order by r.updated_at desc) from public.portal_requests r join public.portal_patients p on p.id=r.patient where portal_private.can_request(r.id)),'[]'),
 'staff',case when v_role='family' then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(p)-'active'-'email') from public.portal_profiles p where p.active and p.role<>'family' and (v_role in ('doctor','personal') or p.role in (v_role,'doctor','personal'))),'[]') end,
 'grants',case when v_role in ('doctor','personal') then coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('patient_name',p.name,'account_name',q.name)) from public.portal_grants g join public.portal_patients p on p.id=g.patient join public.portal_profiles q on q.id=g.account),'[]') else '[]'::jsonb end,
 'notices',coalesce((select jsonb_agg(to_jsonb(n)-'account'-'event' order by n.created_at desc) from public.portal_notifications n where n.account=aid and portal_private.can_request(n.request)),'[]'),
 'preferences',coalesce((select to_jsonb(p.priorities) from public.portal_preferences p where p.account=aid),'[0,1,2,3]'),
 'settings',case when v_role='doctor' then jsonb_build_object('absence',(select value from public.portal_settings where key='absence'),'delivery',(select value from public.portal_settings where key='delivery')) else null end);
 elsif op='detail' then return portal_private.detail((b->>'id')::uuid);
 elsif op='create' then
 if v_role<>'family' then raise insufficient_privilege; end if;
 pid:=(b->>'patient')::uuid; reason:=(b->>'reason')::integer;
 if reason not between 0 and 4 or not portal_private.has_grant(pid,aid,case when reason in (0,1) then 'manage' else 'submit' end) then raise insufficient_privilege; end if;
 if nullif(b->>'center','') is not null and not exists(select 1 from public.portal_enrollments e where e.patient=pid and e.center=b->>'center') then raise insufficient_privilege; end if;
 body:=trim(b->>'description');
 if body is null or length(body) not between 1 and 6000 then raise invalid_parameter_value; end if;
 if reason=0 then
 if coalesce(length(trim(b->>'purpose')),0) not between 1 and 300 or coalesce(length(trim(b->>'destination')),0) not between 1 and 300 or (b->>'needed') is null or not(b->>'needed' ~ '^\d{4}-\d{2}-\d{2}$') then raise invalid_parameter_value; end if;
 perform (b->>'needed')::date;
 body:=body||E'\nFinalidad: '||trim(b->>'purpose')||E'\nDestinatario del documento: '||trim(b->>'destination')||E'\nSe necesita: '||(b->>'needed');
 elsif reason in (2,3) then
 if coalesce(length(trim(b->>'since')),0) not between 1 and 300 or coalesce(length(trim(b->>'contact')),0) not between 1 and 300 or coalesce(b->>'current','') not in ('Sí','No','No lo tengo claro') then raise invalid_parameter_value; end if;
 body:=body||E'\nDesde cuándo: '||trim(b->>'since')||E'\nOcurre actualmente: '||(b->>'current')||E'\nContacto seguro: '||trim(b->>'contact'); end if;
 perform portal_private.validate_recipients(pid,audience,true);
 priority:=portal_private.classify(body,reason);
 insert into public.portal_requests(patient,requester,center,reason,state,priority,rules_version)
 values(pid,aid,nullif(b->>'center',''),reason,case when nullif(b->>'center','') is null then 'Pendiente de asignación' else 'Registrada' end,priority,(select value#>>'{}' from public.portal_settings where key='rules')) returning id into rid;
 insert into public.portal_messages(request,author,kind,body,center) values(rid,aid,'clinical',body,nullif(b->>'center','')) returning id into mid;
 insert into public.portal_message_recipients select mid,value::uuid from jsonb_array_elements_text(audience) on conflict do nothing;
 insert into public.portal_observations(request) values(rid);
 perform portal_private.append_audit('request.saved',rid,jsonb_build_object('priority',priority)); perform portal_private.queue(rid);
 return portal_private.detail(rid);
 end if;

 -- Operations on grants and global settings do not accept request context.
 if op='grant_revoke' then
 if v_role not in ('doctor','personal') then raise insufficient_privilege; end if;
 select * into strict g from public.portal_grants where id=(b->>'id')::uuid;
 update public.portal_grants set revoked_at=at_time where id=g.id;
 delete from portal_private.download_tickets where account=g.account;
 perform portal_private.append_audit('grant.revoked',g.patient,jsonb_build_object('grant',g.id)); return '{}'::jsonb;
 elsif op='grant_review' then
 if v_role not in ('doctor','personal') then raise insufficient_privilege; end if;
 select * into strict g from public.portal_grants where id=(b->>'id')::uuid;
 if coalesce(b->>'evidence','') !~ '^[A-Za-z0-9_-]{4,120}$' or coalesce(b->>'review_on','') !~ '^\d{4}-\d{2}-\d{2}$' or (b->>'review_on')::date<=(now() at time zone 'America/Santiago')::date then raise invalid_parameter_value; end if;
 if jsonb_typeof(b->'manage') is distinct from 'boolean' or jsonb_typeof(b->'submit') is distinct from 'boolean' or jsonb_typeof(b->'clinical') is distinct from 'boolean' then raise invalid_parameter_value; end if;
 update public.portal_grants set manage=(b->>'manage')::boolean,submit=(b->>'submit')::boolean,clinical=(b->>'clinical')::boolean,
 verified_by=aid,evidence=b->>'evidence',review_on=(b->>'review_on')::date,revoked_at=null where id=g.id;
 perform portal_private.append_audit('grant.reviewed',g.patient,jsonb_build_object('grant',g.id)); return '{}'::jsonb;
 elsif op='preferences' then
 if v_role='family' or jsonb_typeof(b->'priorities')<>'array' then raise insufficient_privilege; end if;
 if exists(select 1 from jsonb_array_elements_text(b->'priorities') x where x::integer not between 0 and 3) then raise invalid_parameter_value; end if;
 insert into public.portal_preferences(account,priorities) values(aid,array(select distinct value::integer from jsonb_array_elements_text(b->'priorities'))) on conflict(account) do update set priorities=excluded.priorities;
 perform portal_private.append_audit('notifications.preferences',aid); return '{}'::jsonb;
 elsif op='settings' then
 if v_role<>'doctor' then raise insufficient_privilege; end if;
 if b ? 'absence' then
 if jsonb_typeof(b->'absence'->'enabled')<>'boolean' then raise invalid_parameter_value; end if;
 if b->'absence'->>'until' is not null then perform (b->'absence'->>'until')::timestamptz; end if;
 update public.portal_settings set value=jsonb_build_object('enabled',b->'absence'->'enabled','until',b->'absence'->'until') where key='absence'; end if;
 if b ? 'delivery' then
 conf:=b->'delivery';
 if (conf->>'backup') is not null or coalesce((conf->>'maxAttempts')::integer,0) not between 1 and 10
 or (conf->>'retryMinutes' is not null and (conf->>'retryMinutes')::integer not between 1 and 10080)
 or (conf->>'escalateMinutes' is not null and (conf->>'escalateMinutes')::integer not between 1 and 10080) then raise invalid_parameter_value; end if;
 update public.portal_settings set value=jsonb_build_object('backup',null,'maxAttempts',conf->'maxAttempts','retryMinutes',conf->'retryMinutes','escalateMinutes',conf->'escalateMinutes') where key='delivery'; end if;
 perform portal_private.append_audit('settings.changed',null); return '{}'::jsonb;
 elsif op='rules' then
 if v_role<>'doctor' then raise insufficient_privilege; end if;
 current_rules:=b->'config';
 if coalesce(current_rules->>'version','') !~ '^ilustrativa-[a-z0-9-]{1,40}$' or current_rules->'approved' is distinct from 'false'::jsonb or coalesce(length(trim(b->>'reason')),0) not between 1 and 500 then raise invalid_parameter_value; end if;
 foreach body in array array['red','orange','yellow'] loop
 if jsonb_typeof(current_rules->body) is distinct from 'array' or jsonb_array_length(current_rules->body)>30 or exists(select 1 from jsonb_array_elements_text(current_rules->body) p where length(trim(p)) not between 1 and 100) then raise invalid_parameter_value; end if;
 end loop;
 insert into public.portal_rules(version,config,author,change_reason) values(current_rules->>'version',current_rules,aid,b->>'reason');
 update public.portal_settings set value=to_jsonb(current_rules->>'version') where key='rules'; perform portal_private.append_audit('rules.versioned',null); return current_rules;
 elsif op='notification_test' then
 if v_role<>'doctor' or coalesce(b->>'outcome','') not in ('delivered','failed') then raise insufficient_privilege; end if;
 select value into conf from public.portal_settings where key='delivery'; outcome:=b->>'outcome';
 for n in select * from public.portal_notifications where channel<>'internal' and status in ('queued_test','held_coverage','failed_test') and (next_at is null or next_at<=now()) for update skip locked loop
 select * into r from public.portal_requests where id=n.request; select * into dest from public.portal_profiles where id=n.account;
 if not dest.active or (dest.role='cenit' and r.center is distinct from 'CENIT') or (dest.role='cenepsi' and r.center is distinct from 'Cenepsi') then update public.portal_notifications set status='cancelled_access' where id=n.id; continue; end if;
 if dest.role='doctor' and not portal_private.active_coverage() then update public.portal_notifications set status='held_coverage' where id=n.id; continue; end if;
 if n.attempts>=(conf->>'maxAttempts')::integer or (n.status='failed_test' and conf->>'retryMinutes' is null) then continue; end if;
 update public.portal_notifications set status=case when outcome='delivered' then 'provider_reported_test' else 'failed_test' end,attempts=attempts+1,
 next_at=case when conf->>'retryMinutes' is null then null else now()+make_interval(mins=>(conf->>'retryMinutes')::integer) end,
 delivered_at=case when outcome='delivered' then now() else null end where id=n.id;
 perform portal_private.append_audit('notification.test',n.request,jsonb_build_object('channel',n.channel,'outcome',outcome));
 end loop;
 if conf->>'escalateMinutes' is not null and portal_private.active_coverage() then
 update public.portal_notifications n set status='needs_manual_escalation' from public.portal_requests r where n.request=r.id and n.account=aid and n.channel='internal' and r.accepted_at is null and r.priority>=2 and r.state<>'Cerrada' and r.created_at<=now()-make_interval(mins=>(conf->>'escalateMinutes')::integer); end if;
 return jsonb_build_object('mode','test','externalMessagesSent',0);
 end if;

 -- Resolve document IDs through authorized request scope, never by the caller's chosen center.
 if op in ('approve','ticket') then
 select * into strict d from public.portal_documents where id=(b->>'id')::uuid;
 if not portal_private.can_document(d.id) then raise insufficient_privilege; end if; rid:=d.request;
 elsif op='consume_ticket' then
 delete from portal_private.download_tickets where hash=encode(extensions.digest(b->>'token','sha256'),'hex') and account=aid
 and session_id=nullif((select auth.jwt())->>'session_id','')::uuid and expires_at>now() returning * into ticket;
 if not found or not portal_private.can_document(ticket.document) then raise insufficient_privilege; end if;
 select * into strict d from public.portal_documents where id=ticket.document;
 perform portal_private.append_audit('document.download',d.request,jsonb_build_object('document',d.id));
 return jsonb_build_object('id',d.id,'storage_path',d.storage_path,'mime',d.mime,'filename',d.filename);
 else rid:=(b->>'id')::uuid; end if;
 if not portal_private.can_request(rid) then raise exception using errcode='42501',message='Solicitud no disponible.'; end if;
 select * into strict r from public.portal_requests where id=rid for update;
 if op='message' then
 if r.state='Cerrada' then raise invalid_parameter_value; end if;
 body:=trim(b->>'body'); if body is null or length(body) not between 1 and 6000 or coalesce(b->>'kind','') not in ('clinical','administrative') then raise invalid_parameter_value; end if;
 if v_role='family' and (b->>'kind'<>'clinical' or not(portal_private.has_grant(r.patient,aid,'submit') or (r.reason in (0,1) and portal_private.has_grant(r.patient,aid,'manage')))) then raise insufficient_privilege; end if;
 if v_role not in ('family','doctor') and b->>'kind'='clinical' then raise insufficient_privilege; end if;
 if b->>'kind'='administrative' and portal_private.classify(body,0)>=2 then raise exception using errcode='22023',message='Deriva este contenido al canal clínico restringido.'; end if;
 if b->>'kind'='clinical' then perform portal_private.validate_recipients(r.patient,audience,true); else audience:='[]'; end if;
 insert into public.portal_messages(request,author,kind,body,center) values(rid,aid,b->>'kind',body,r.center) returning id into mid;
 insert into public.portal_message_recipients select mid,value::uuid from jsonb_array_elements_text(audience) on conflict do nothing;
 update public.portal_requests set updated_at=at_time,priority=case when v_role='family' then greatest(r.priority,portal_private.classify(body,r.reason)) else r.priority end,
 rules_version=(select value#>>'{}' from public.portal_settings where key='rules') where id=rid;
 perform portal_private.append_audit('message.added',rid,jsonb_build_object('kind',b->>'kind')); perform portal_private.queue(rid);
 elsif op='action' then
 if v_role='family' then raise insufficient_privilege; end if;
 if b->>'action'='accept' then
 if (r.assigned is not null and r.assigned<>aid) or r.accepted_by=aid then raise invalid_parameter_value; end if;
 if (r.priority>=2 or r.state like '%médica%') and v_role<>'doctor' then raise insufficient_privilege; end if;
 update public.portal_requests set accepted_by=aid,accepted_at=at_time,assigned=aid,state=case when v_role='doctor' then 'En revisión médica' else 'En revisión administrativa' end where id=rid;
 elsif b->>'action'='assign' then
 select * into strict dest from public.portal_profiles where id=(b->>'assigned')::uuid and active and portal_profiles.role<>'family';
 if v_role not in ('doctor','personal') and dest.role not in (v_role,'doctor','personal') then raise insufficient_privilege; end if;
 if (dest.role='cenit' and r.center is distinct from 'CENIT') or (dest.role='cenepsi' and r.center is distinct from 'Cenepsi') then raise insufficient_privilege; end if;
 update public.portal_requests set assigned=dest.id,accepted_by=null,accepted_at=null,state=case when dest.role='doctor' then 'Pendiente de revisión médica' else 'Asignada' end where id=rid;
 elsif b->>'action'='state' then
 if b->>'state' in ('En revisión médica','Respondida','Cerrada') and v_role<>'doctor' then raise insufficient_privilege; end if;
 if b->>'state'='En revisión médica' and r.accepted_by is distinct from aid then raise invalid_parameter_value; end if;
 update public.portal_requests set state=b->>'state' where id=rid;
 elsif b->>'action'='priority' then
 if v_role<>'doctor' or coalesce((b->>'priority')::integer,-1) not between 0 and 3 or coalesce(length(trim(b->>'reason')),0) not between 1 and 500 then raise insufficient_privilege; end if;
 update public.portal_requests set priority=(b->>'priority')::integer where id=rid;
 insert into public.portal_messages(request,author,kind,body,center) values(rid,aid,'clinical','Cambio de prioridad: '||(b->>'reason'),r.center);
 elsif b->>'action'='center' then
 if v_role not in ('doctor','personal') or coalesce(length(trim(b->>'reason')),0) not between 1 and 500 or not exists(select 1 from public.portal_enrollments e where e.patient=r.patient and e.center=b->>'center') then raise insufficient_privilege; end if;
 update public.portal_requests set center=b->>'center',assigned=null,accepted_by=null,accepted_at=null,state='Pendiente de asignación' where id=rid;
 update public.portal_notifications n set status='cancelled_access' from public.portal_profiles p where n.account=p.id and n.request=rid and p.role in ('cenit','cenepsi') and n.status in ('queued_test','held_coverage','failed_test');
 elsif b->>'action'='record' then
 if v_role<>'doctor' then raise insufficient_privilege; end if;
 update public.portal_requests set recorded_at=at_time where id=rid;
 elsif b->>'action'='due' then
 if b->>'due' is not null and (b->>'due')::timestamptz<=now() then raise invalid_parameter_value; end if;
 update public.portal_requests set due_at=(b->>'due')::timestamptz where id=rid;
 else raise invalid_parameter_value; end if;
 update public.portal_requests set updated_at=at_time where id=rid;
 perform portal_private.append_audit('request.'||(b->>'action'),rid,case when b->>'action'='center' then jsonb_build_object('from',r.center,'to',b->>'center','reason',b->>'reason') when b->>'action'='priority' then jsonb_build_object('from',r.priority,'to',(b->>'priority')::integer) else '{}'::jsonb end);
 perform portal_private.queue(rid);
 elsif op='document_prepare' then
 if v_role='family' or (coalesce((b->>'clinical')::boolean,false) and v_role<>'doctor') then raise insufficient_privilege; end if;
 if coalesce(length(trim(b->>'filename')),0) not between 1 and 120 or b->>'filename' ~ E'[/\\\\\r\n]' or coalesce(b->>'mime','') not in ('application/pdf','image/png','image/jpeg') then raise invalid_parameter_value; end if;
 perform portal_private.validate_recipients(r.patient,audience,coalesce((b->>'clinical')::boolean,false));
 did:=gen_random_uuid(); series_id:=did; ver:=1;
 if b->>'previous' is not null then
 select * into strict d from public.portal_documents where id=(b->>'previous')::uuid and request=rid;
 if not portal_private.can_document(d.id) or d.clinical<>coalesce((b->>'clinical')::boolean,false) then raise insufficient_privilege; end if;
 series_id:=d.series; select max(version)+1 into ver from public.portal_documents where series=series_id; end if;
 insert into public.portal_documents(id,request,series,version,uploader,center,clinical,filename,mime,storage_path,upload_state)
 values(did,rid,series_id,ver,aid,r.center,coalesce((b->>'clinical')::boolean,false),b->>'filename',b->>'mime',did::text||'/file','pending');
 insert into public.portal_document_recipients select did,value::uuid from jsonb_array_elements_text(audience) on conflict do nothing;
 return jsonb_build_object('id',did,'storage_path',did::text||'/file');
 elsif op in ('document_finish','document_abort') then
 select * into strict d from public.portal_documents where id=(b->>'document')::uuid and request=rid and uploader=aid and upload_state='pending';
 if op='document_abort' then delete from public.portal_documents where id=d.id;
 else
 if not exists(select 1 from storage.objects where bucket_id='portal-documents' and name=d.storage_path) then raise invalid_parameter_value; end if;
 update public.portal_documents set upload_state='ready' where id=d.id;
 perform portal_private.append_audit('document.draft',rid,jsonb_build_object('document',d.id,'version',d.version)); end if;
 elsif op='approve' then
 if v_role<>'doctor' or d.version<>(select max(version) from public.portal_documents where series=d.series) or not exists(select 1 from public.portal_document_recipients where document=d.id) then raise insufficient_privilege; end if;
 perform portal_private.validate_recipients(r.patient,(select jsonb_agg(account) from public.portal_document_recipients where document=d.id),d.clinical);
 update public.portal_documents set approved_by=aid,approved_at=at_time where id=d.id;
 perform portal_private.append_audit('document.approved',rid,jsonb_build_object('document',d.id,'version',d.version));
 elsif op='ticket' then
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into portal_private.download_tickets(hash,document,account,session_id,expires_at)
 values(encode(extensions.digest(token,'sha256'),'hex'),d.id,aid,nullif((select auth.jwt())->>'session_id','')::uuid,now()+interval '60 seconds'); return to_jsonb(token);
 elsif op='observe' then
 if v_role<>'doctor' then raise insufficient_privilege; end if;
 insert into public.portal_observations(request,status,payload) values(rid,'not_configured',null) on conflict(request) do update set status='not_configured',payload=null;
 perform portal_private.append_audit('ai.observed',rid);
 else raise invalid_parameter_value; end if;
 return portal_private.detail(rid);
 end
$$;

create function public.portal_command(op text,b jsonb default '{}') returns jsonb language sql volatile security invoker set search_path='' as $$ select portal_private.dispatch(op,b) $$;
revoke all on function public.portal_command(text,jsonb) from public,anon;
grant execute on function public.portal_command(text,jsonb) to authenticated;

create function portal_private.identity() returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(p)-'active' from public.portal_profiles p where p.id=portal_private.session_user()
$$;
create function public.portal_identity() returns jsonb language sql stable security invoker set search_path='' as $$ select portal_private.identity() $$;
revoke all on function public.portal_identity() from public,anon;
grant execute on function public.portal_identity() to authenticated;
create function portal_private.public_info() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('rules',(select config from public.portal_rules where version=(select value#>>'{}' from public.portal_settings where key='rules')),
 'absence',(select value from public.portal_settings where key='absence'))
$$;
create function public.portal_public() returns jsonb language sql stable security invoker set search_path='' as $$ select portal_private.public_info() $$;
revoke all on function public.portal_public() from public;
grant execute on function public.portal_public() to anon,authenticated;

-- Storage is deliberately mediated: no patient/representative token can bypass the
-- single-use ticket/audit/download endpoint. The backend key is used ONLY for object
-- transfer after an authorized command, never to fetch ordinary clinical records.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('portal-documents','portal-documents',false,2097152,array['application/pdf','image/png','image/jpeg']) on conflict(id) do nothing;
create policy portal_objects_no_direct_read on storage.objects for select to authenticated using(bucket_id='portal-documents' and false);
-- There are intentionally no authenticated INSERT/UPDATE/DELETE object policies.

revoke all on all functions in schema portal_private from public,anon,authenticated;
grant usage on schema portal_private to authenticated;
grant execute on function portal_private.session_user(),portal_private.actor_role(),portal_private.actor(),portal_private.has_grant(uuid,uuid,text),portal_private.can_patient(uuid),portal_private.can_request(uuid),portal_private.can_message(uuid),portal_private.can_document(uuid),portal_private.dispatch(text,jsonb) to authenticated;

grant usage on schema portal_private to anon;
grant execute on function portal_private.public_info() to anon,authenticated;
grant execute on function portal_private.identity() to authenticated;
