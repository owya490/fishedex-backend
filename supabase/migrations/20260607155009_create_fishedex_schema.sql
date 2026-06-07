create extension if not exists pgcrypto with schema extensions;

create table if not exists public.fish_species (
  id serial primary key,
  name text not null unique,
  scientific_name text not null default 'Profile pending',
  image_name text not null default 'MysteryFish',
  habitat text not null,
  rarity_stars smallint not null default 1 check (rarity_stars >= 1 and rarity_stars <= 3),
  is_rare boolean not null default false,
  about text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  level integer not null default 1 check (level >= 1),
  status_title text not null default 'ROOKIE ANGLER',
  rank_label text not null default 'NOVICE ANGLER',
  current_biome text not null default 'LOCAL WATERS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_catches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  species_id integer not null references public.fish_species(id) on delete cascade,
  weight_lbs numeric,
  caught_at timestamptz not null default now(),
  unique (user_id, species_id)
);

create index if not exists user_catches_user_id_idx on public.user_catches (user_id);
create index if not exists user_catches_species_id_idx on public.user_catches (species_id);

create table if not exists public.achievements (
  id serial primary key,
  slug text not null unique,
  title text not null,
  description text not null default '',
  sort_order integer not null default 0
);

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id integer not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.fish_species enable row level security;
alter table public.profiles enable row level security;
alter table public.user_catches enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

create policy "Fish species are publicly readable"
on public.fish_species
for select
to public
using (true);

create policy "Profiles are publicly readable"
on public.profiles
for select
to public
using (true);

create policy "Users can insert own profile"
on public.profiles
for insert
to public
with check (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles
for update
to public
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users read own catches"
on public.user_catches
for select
to public
using (auth.uid() = user_id);

create policy "Users insert own catches"
on public.user_catches
for insert
to public
with check (auth.uid() = user_id);

create policy "Users update own catches"
on public.user_catches
for update
to public
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users delete own catches"
on public.user_catches
for delete
to public
using (auth.uid() = user_id);

create policy "Achievements are publicly readable"
on public.achievements
for select
to public
using (true);

create policy "Users read own unlocked achievements"
on public.user_achievements
for select
to public
using (auth.uid() = user_id);

create policy "Users unlock own achievements"
on public.user_achievements
for insert
to public
with check (auth.uid() = user_id);
