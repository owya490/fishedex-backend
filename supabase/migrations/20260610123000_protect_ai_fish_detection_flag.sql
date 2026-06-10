-- Only service-role / SQL editor updates may change ai_fish_detection_enabled.
-- Authenticated users cannot grant themselves access via the profiles API.

create or replace function public.protect_ai_fish_detection_flag()
returns trigger
language plpgsql
as $$
begin
  if new.ai_fish_detection_enabled is distinct from old.ai_fish_detection_enabled then
    if coalesce(auth.role(), '') in ('authenticated', 'anon') then
      new.ai_fish_detection_enabled := old.ai_fish_detection_enabled;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_ai_fish_detection_flag on public.profiles;
create trigger protect_ai_fish_detection_flag
before update on public.profiles
for each row
execute function public.protect_ai_fish_detection_flag();

comment on column public.profiles.ai_fish_detection_enabled is
  'Admin-controlled entitlement for classify-fish. Enable via Supabase SQL editor or service role.';
