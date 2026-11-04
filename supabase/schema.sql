-- GamaLab: backend do experimento coletivo de precipitação.
-- Execute no Supabase SQL Editor. Não use service_role nem chaves secretas no navegador.

create schema if not exists gama_internal;
revoke all on schema gama_internal from public, anon, authenticated;

create table if not exists public.gama_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{8}$'),
  status text not null default 'aberta' check (status in ('aberta','encerrada')),
  modo text not null default 'dia' check (modo in ('dia','mes')),
  alpha double precision not null default 0.8 check (alpha between 0.2 and 8),
  theta double precision not null default 15 check (theta between 0.5 and 100),
  seca double precision not null default 0.45 check (seca between 0 and 0.95),
  limit_a double precision not null default 30 check (limit_a > 0),
  limit_b double precision not null default 50 check (limit_b > limit_a),
  epoch integer not null default 1,
  total_samples integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists gama_internal.settings (
  key text primary key, value text not null
);
insert into gama_internal.settings (key, value)
values ('pin_hash', 'CONFIGURE_O_PIN_APOS_EXECUTAR_SCHEMA')
on conflict (key) do nothing;

create table if not exists gama_internal.host_secrets (
  room_id uuid primary key references public.gama_rooms(id) on delete cascade,
  secret_hash text not null
);

create table if not exists public.gama_batches (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.gama_rooms(id) on delete cascade,
  epoch integer not null,
  participant_id uuid not null,
  request_id uuid not null,
  amostras double precision[] not null,
  created_at timestamptz not null default now(),
  unique(room_id, epoch, participant_id, request_id)
);
create index if not exists gama_batches_room_epoch_idx
  on public.gama_batches(room_id, epoch, created_at);
create index if not exists gama_batches_participant_idx
  on public.gama_batches(room_id, epoch, participant_id);

alter table public.gama_rooms enable row level security;
alter table public.gama_batches enable row level security;
revoke all on public.gama_rooms, public.gama_batches from public, anon, authenticated;
grant select on public.gama_rooms, public.gama_batches to anon, authenticated;
drop policy if exists gama_rooms_read on public.gama_rooms;
create policy gama_rooms_read on public.gama_rooms for select to anon, authenticated using (true);
drop policy if exists gama_batches_read on public.gama_batches;
create policy gama_batches_read on public.gama_batches for select to anon, authenticated using (true);

-- Sorteio exato de valores gama: Marsaglia-Tsang para forma>=1
-- e redução recursiva para forma<1.
create or replace function gama_internal.gamma_sample(p_alpha double precision, p_theta double precision)
returns double precision
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_d double precision;
  v_c double precision;
  v_x double precision;
  v_v double precision;
  v_u double precision;
  v_i integer;
begin
  if p_alpha <= 0 or p_theta <= 0 then
    raise exception 'Parâmetros inválidos.';
  end if;
  if p_alpha < 1 then
    return gama_internal.gamma_sample(p_alpha + 1, p_theta)
      * power(greatest(random(), 1e-15), 1.0 / p_alpha);
  end if;
  v_d := p_alpha - 1.0 / 3.0;
  v_c := 1.0 / sqrt(9.0 * v_d);
  for v_i in 1..1000 loop
    v_x := sqrt(-2.0 * ln(greatest(random(), 1e-15))) * cos(2.0 * pi() * random());
    v_v := 1.0 + v_c * v_x;
    if v_v <= 0 then continue; end if;
    v_v := v_v * v_v * v_v;
    v_u := greatest(random(), 1e-15);
    if (v_u < 1.0 - 0.0331 * power(v_x, 4)) or
       (ln(v_u) < 0.5 * v_x * v_x + v_d * (1.0 - v_v + ln(v_v))) then
      return p_theta * v_d * v_v;
    end if;
  end loop;
  raise exception 'Não foi possível sortear o valor gama.';
end;
$$;
revoke execute on function gama_internal.gamma_sample(double precision,double precision)
  from public, anon, authenticated;

create or replace function public.gama_create_room(p_host_pin text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pin_hash text;
  v_id uuid;
  v_code text;
  v_token text;
  v_attempt integer;
begin
  select value into v_pin_hash from gama_internal.settings where key = 'pin_hash';
  if v_pin_hash is null or v_pin_hash = 'CONFIGURE_O_PIN_APOS_EXECUTAR_SCHEMA' then
    raise exception 'O administrador ainda não configurou a senha do professor.';
  end if;
  if p_host_pin is null or length(p_host_pin) < 12 or md5(p_host_pin) <> v_pin_hash then
    raise exception 'Senha do professor incorreta.';
  end if;
  v_id := gen_random_uuid();
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  for v_attempt in 1..10 loop
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 8));
    begin
      insert into public.gama_rooms(id, code) values(v_id, v_code);
      exit;
    exception when unique_violation then
      if v_attempt = 10 then raise exception 'Não foi possível criar código único.'; end if;
    end;
  end loop;
  insert into gama_internal.host_secrets(room_id, secret_hash)
    values(v_id, md5(v_token || v_id::text));
  return jsonb_build_object('code', v_code, 'token', v_token);
end;
$$;

create or replace function public.gama_update_room(
  p_code text, p_host_token text, p_modo text,
  p_alpha double precision, p_theta double precision, p_seca double precision,
  p_limit_a double precision, p_limit_b double precision
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_room public.gama_rooms%rowtype;
  v_hash text;
begin
  select * into v_room from public.gama_rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Sala não encontrada.'; end if;
  select secret_hash into v_hash from gama_internal.host_secrets where room_id = v_room.id;
  if p_host_token is null or md5(p_host_token || v_room.id::text) <> v_hash then
    raise exception 'Controle do professor não autorizado.';
  end if;
  if p_modo not in ('dia','mes') or p_alpha not between 0.2 and 8 or
     p_theta not between 0.5 and 100 or p_seca not between 0 and 0.95 or
     p_limit_a <= 0 or p_limit_b <= p_limit_a or p_limit_b > 5000 then
    raise exception 'Parâmetros inválidos.';
  end if;
  update public.gama_rooms set
    modo = p_modo, alpha = p_alpha, theta = p_theta, seca = p_seca,
    limit_a = p_limit_a, limit_b = p_limit_b,
    epoch = epoch + 1, total_samples = 0
  where id = v_room.id;
  delete from public.gama_batches where room_id = v_room.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.gama_room_action(p_code text, p_host_token text, p_action text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_room public.gama_rooms%rowtype;
  v_hash text;
begin
  select * into v_room from public.gama_rooms where code=upper(trim(p_code)) for update;
  if not found then raise exception 'Sala não encontrada.'; end if;
  select secret_hash into v_hash from gama_internal.host_secrets where room_id=v_room.id;
  if p_host_token is null or md5(p_host_token || v_room.id::text) <> v_hash then
    raise exception 'Controle do professor não autorizado.';
  end if;
  if p_action = 'limpar' then
    update public.gama_rooms set epoch=epoch+1,total_samples=0 where id=v_room.id;
    delete from public.gama_batches where room_id=v_room.id;
  elsif p_action = 'encerrar' then
    update public.gama_rooms set status='encerrada' where id=v_room.id;
  elsif p_action = 'reabrir' then
    if v_room.expires_at <= now() then raise exception 'Sala expirada; crie outra.'; end if;
    update public.gama_rooms set status='aberta' where id=v_room.id;
  else
    raise exception 'Ação desconhecida.';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.gama_submit(
  p_code text, p_participant_id uuid, p_request_id uuid, p_count integer
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_room public.gama_rooms%rowtype;
  v_existing double precision[];
  v_samples double precision[] := '{}'::double precision[];
  v_contrib integer;
  v_i integer;
  v_day integer;
  v_amount double precision;
begin
  if p_participant_id is null or p_request_id is null or p_count not in (1,10,50) then
    raise exception 'Pedido inválido.';
  end if;
  select * into v_room from public.gama_rooms where code=upper(trim(p_code)) for update;
  if not found then raise exception 'Sala não encontrada.'; end if;
  if v_room.status <> 'aberta' or v_room.expires_at < now() then
    raise exception 'Sala fechada ou expirada.';
  end if;
  select amostras into v_existing from public.gama_batches
   where room_id=v_room.id and epoch=v_room.epoch
     and participant_id=p_participant_id and request_id=p_request_id;
  if found then
    return jsonb_build_object('amostras', to_jsonb(v_existing),
      'total', v_room.total_samples, 'epoch', v_room.epoch, 'repetido', true);
  end if;
  select coalesce(sum(array_length(amostras, 1)),0)::integer into v_contrib
    from public.gama_batches where room_id=v_room.id and epoch=v_room.epoch
      and participant_id=p_participant_id;
  if v_contrib + p_count > 400 then
    raise exception 'Limite de 400 experimentos por participante nesta rodada.';
  end if;
  if v_room.total_samples + p_count > 40000 then
    raise exception 'Limite da sala alcançado; peça ao professor para limpar o gráfico.';
  end if;
  for v_i in 1..p_count loop
    v_amount := 0;
    if v_room.modo = 'dia' then
      v_amount := gama_internal.gamma_sample(v_room.alpha, v_room.theta);
    else
      for v_day in 1..31 loop
        if random() >= v_room.seca then
          v_amount := v_amount + gama_internal.gamma_sample(v_room.alpha, v_room.theta);
        end if;
      end loop;
    end if;
    v_samples := array_append(v_samples, v_amount);
  end loop;
  insert into public.gama_batches(room_id,epoch,participant_id,request_id,amostras)
    values(v_room.id,v_room.epoch,p_participant_id,p_request_id,v_samples);
  update public.gama_rooms set total_samples=total_samples+p_count where id=v_room.id;
  return jsonb_build_object('amostras',to_jsonb(v_samples),'total',v_room.total_samples+p_count,
    'epoch',v_room.epoch,'repetido',false);
end;
$$;

revoke execute on function public.gama_create_room(text) from public, anon, authenticated;
revoke execute on function public.gama_update_room(text,text,text,double precision,double precision,double precision,double precision,double precision) from public, anon, authenticated;
revoke execute on function public.gama_room_action(text,text,text) from public, anon, authenticated;
revoke execute on function public.gama_submit(text,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.gama_create_room(text) to anon, authenticated;
grant execute on function public.gama_update_room(text,text,text,double precision,double precision,double precision,double precision,double precision) to anon, authenticated;
grant execute on function public.gama_room_action(text,text,text) to anon, authenticated;
grant execute on function public.gama_submit(text,uuid,uuid,integer) to anon, authenticated;

do $$ begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gama_rooms') then
    alter publication supabase_realtime add table public.gama_rooms;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gama_batches') then
    alter publication supabase_realtime add table public.gama_batches;
  end if;
end $$;

-- Próxima etapa, somente no Supabase SQL Editor:
-- update gama_internal.settings set value = md5('SUA-SENHA-FORTE-E-PRIVADA')
-- where key = 'pin_hash';
