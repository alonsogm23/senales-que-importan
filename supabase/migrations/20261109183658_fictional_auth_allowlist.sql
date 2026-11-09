-- Test-only guard: no public registration, real email addresses or phone identities.
create table portal_private.demo_auth_permits(email text primary key, expires_at timestamptz not null);
create table portal_private.demo_bootstrap(hash text primary key, expires_at timestamptz not null);
alter table portal_private.demo_auth_permits enable row level security;
alter table portal_private.demo_bootstrap enable row level security;
revoke all on portal_private.demo_auth_permits,portal_private.demo_bootstrap from public,anon,authenticated;
create function portal_private.guard_demo_auth() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email not like '%@example.invalid' or coalesce(new.phone,'')<>'' or coalesce(new.phone_change,'')<>'' or (coalesce(new.email_change,'')<>'' and new.email_change not like '%@example.invalid') then
 raise exception using errcode='42501',message='Solo identidades ficticias autorizadas.'; end if;
 if TG_OP='INSERT' then
 delete from portal_private.demo_auth_permits where email=lower(new.email) and expires_at>now();
 if not found then raise exception using errcode='42501',message='El alta requiere aprovisionamiento autorizado.'; end if;
 elsif new.email is distinct from old.email then raise insufficient_privilege;
 end if;
 return new;
end $$;
revoke all on function portal_private.guard_demo_auth() from public,anon,authenticated;
create trigger portal_demo_auth_guard before insert or update on auth.users for each row execute function portal_private.guard_demo_auth();
-- Temporary bootstrap RPC is removed after provisioning. No role or email parameters.
create function portal_private.claim_demo_nonce(nonce text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 delete from portal_private.demo_bootstrap where hash=encode(extensions.digest(nonce,'sha256'),'hex') and expires_at>now();
 return found;
end $$;
revoke all on function portal_private.claim_demo_nonce(text) from public;
grant execute on function portal_private.claim_demo_nonce(text) to anon;
create function public.portal_demo_claim_nonce(nonce text) returns boolean language sql security invoker set search_path='' as $$ select portal_private.claim_demo_nonce(nonce) $$;
revoke all on function public.portal_demo_claim_nonce(text) from public;
grant execute on function public.portal_demo_claim_nonce(text) to anon;
