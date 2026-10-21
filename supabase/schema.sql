-- Arena online da Pokédex Web no Supabase.
-- Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
-- Antes: Authentication → Sign In / Providers → ligar "Allow anonymous sign-ins".
-- Pode correr mais de uma vez (recria funções e políticas).

-- ---------- salas ----------
-- uma linha por sala; cada jogador só altera as suas colunas (_host ou _conv), por isso não há corridas
create table if not exists public.salas (
  codigo        text primary key check (codigo ~ '^[A-Z0-9]{6}$'),
  host          uuid not null default auth.uid() references auth.users on delete cascade,
  conv          uuid references auth.users on delete set null,
  versao        text,
  modo          int  not null default 3 check (modo in (1, 3)),
  time_host     jsonb not null default '[]'::jsonb,   -- ids dos Pokémon
  time_conv     jsonb not null default '[]'::jsonb,
  golpes_host   jsonb not null default '{}'::jsonb,   -- { idPokemon: [índices dos golpes] }
  golpes_conv   jsonb not null default '{}'::jsonb,
  pronto_host   boolean not null default false,
  pronto_conv   boolean not null default false,
  estado        text not null default 'sala' check (estado in ('sala', 'batalha')),
  partida       int  not null default 0,               -- sobe a cada batalha (revanche incluída)
  inicio        jsonb,                                 -- { semente, modo, times:{host,conv}, golpes:{host,conv} }
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------- jogadas ----------
-- tudo o que acontece numa batalha; quem volta depois de minimizar relê isto e reconstrói o estado
create table if not exists public.jogadas (
  id        bigint generated always as identity primary key,
  codigo    text not null references public.salas on delete cascade,
  partida   int  not null,
  n         int  not null,                             -- turno (-1 para pedidos de revanche)
  jogador   uuid not null default auth.uid(),
  tipo      text not null check (tipo in ('acao', 'troca', 'sync', 'revanche')),
  dados     jsonb,
  criado_em timestamptz not null default now(),
  unique (codigo, partida, n, jogador, tipo)
);
create index if not exists jogadas_sala on public.jogadas (codigo, partida);

-- ---------- data de atualização e limpeza de salas antigas ----------
create or replace function public.salas_tocar() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists salas_tocar on public.salas;
create trigger salas_tocar before update on public.salas for each row execute function public.salas_tocar();

create or replace function public.salas_limpar() returns trigger language plpgsql security definer set search_path = public as $$
begin delete from public.salas where atualizado_em < now() - interval '7 days'; return null; end $$;
drop trigger if exists salas_limpar on public.salas;
create trigger salas_limpar after insert on public.salas for each statement execute function public.salas_limpar();

-- ---------- entrar numa sala pelo código ----------
create or replace function public.entrar_sala(p_codigo text) returns public.salas
language plpgsql security definer set search_path = public as $$
declare s public.salas;
begin
  if auth.uid() is null then raise exception 'sem_sessao'; end if;
  select * into s from public.salas where codigo = upper(p_codigo) for update;
  if not found then raise exception 'sala_nao_encontrada'; end if;
  if s.host = auth.uid() or s.conv = auth.uid() then return s; end if;
  if s.conv is not null then raise exception 'sala_cheia'; end if;
  update public.salas set conv = auth.uid() where codigo = s.codigo returning * into s;
  return s;
end $$;
revoke all on function public.entrar_sala(text) from public, anon;
grant execute on function public.entrar_sala(text) to authenticated;

-- ---------- segurança: só os dois jogadores veem e mexem na sala ----------
alter table public.salas enable row level security;
alter table public.jogadas enable row level security;

drop policy if exists salas_ler on public.salas;
drop policy if exists salas_criar on public.salas;
drop policy if exists salas_mudar on public.salas;
drop policy if exists salas_apagar on public.salas;
create policy salas_ler    on public.salas for select to authenticated using (auth.uid() in (host, conv));
create policy salas_criar  on public.salas for insert to authenticated with check (host = auth.uid());
create policy salas_mudar  on public.salas for update to authenticated using (auth.uid() in (host, conv)) with check (auth.uid() in (host, conv));
create policy salas_apagar on public.salas for delete to authenticated using (host = auth.uid());

drop policy if exists jogadas_ler on public.jogadas;
drop policy if exists jogadas_criar on public.jogadas;
create policy jogadas_ler on public.jogadas for select to authenticated using (
  exists (select 1 from public.salas s where s.codigo = jogadas.codigo and auth.uid() in (s.host, s.conv)));
create policy jogadas_criar on public.jogadas for insert to authenticated with check (
  jogador = auth.uid() and exists (select 1 from public.salas s where s.codigo = jogadas.codigo and auth.uid() in (s.host, s.conv)));

grant select, insert, update, delete on public.salas to authenticated;
grant select, insert on public.jogadas to authenticated;

-- ---------- tempo real ----------
do $$ begin
  begin alter publication supabase_realtime add table public.salas; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.jogadas; exception when duplicate_object then null; end;
end $$;
