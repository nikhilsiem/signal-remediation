create table if not exists zoo_cache (key text primary key, value jsonb);
create table if not exists zoo_faults (
  name text primary key,
  "on" boolean not null default false,
  params jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
