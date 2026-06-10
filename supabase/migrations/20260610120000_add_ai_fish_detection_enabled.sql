alter table public.profiles
add column if not exists ai_fish_detection_enabled boolean not null default false;

comment on column public.profiles.ai_fish_detection_enabled is
  'When true, catch photos are sent to the classify-fish edge function for species identification.';
