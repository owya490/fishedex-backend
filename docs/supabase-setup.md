# Supabase Setup For Fishedex

This repo now reflects the existing hosted Supabase project instead of creating new database objects.

## Project

- Name: `Fishedex`
- Project ref: `kfjmzsukylthtstjmmcz`
- Region: `ap-southeast-2`
- Postgres version: `17.6`
- Current deployed Edge Functions: none
- Current Storage buckets: none

## Existing Tables

`fish_species`
The Fishedex catalog. It has 103 rows and uses `id`, `name`, `scientific_name`, `image_name`, `habitat`, `rarity_stars`, `is_rare`, `about`, and `created_at`.

`profiles`
One row per Supabase Auth user. It stores display and progression data: `display_name`, `avatar_url`, `level`, `status_title`, `rank_label`, and `current_biome`.

`user_catches`
The user's dex progress. A row means a user has caught or identified a species. It has a unique `(user_id, species_id)` constraint.

`achievements`
The static achievement catalog. It currently has 15 rows.

`user_achievements`
The achievements unlocked by each user. It has a unique `(user_id, achievement_id)` constraint.

## Existing Migrations

The hosted project reports these migrations:

```text
20260607155009_create_fishedex_schema
20260607155027_seed_fish_species_and_achievements
```

The local files under `supabase/migrations` use those same versions and names.

## Row Level Security

The hosted project has RLS enabled on every public app table.

- `fish_species` and `achievements` are publicly readable.
- `profiles` are publicly readable, but users can only insert or update their own profile.
- `user_catches` are private to the signed-in user for read, insert, update, and delete.
- `user_achievements` are private to the signed-in user for read and insert.

## Auth Trigger

The hosted project has an Auth trigger:

```text
auth.users after insert -> public.handle_new_user()
```

That creates a matching `profiles` row when a new user signs up.

## Edge Function

The local Edge Function is:

```text
supabase/functions/classify-fish/index.ts
```

It has not been deployed yet, matching the current hosted project state.

It receives an image, reads the existing `fish_species` catalog, asks OpenAI to match the image only to an existing `fish_species.name`, then upserts a row into `user_catches` when it finds a match.

It does not create a new table, does not use Storage, and does not write a separate classification history because those objects do not currently exist in the hosted project.

## Local Commands

Install Supabase CLI if needed:

```sh
brew install supabase/tap/supabase
```

Run local Supabase once Docker Desktop is open:

```sh
supabase start
supabase db reset
```

Serve the local Edge Function:

```sh
supabase functions serve classify-fish --env-file .env
```

Example request:

```sh
curl -i \
  -X POST 'http://127.0.0.1:54321/functions/v1/classify-fish' \
  -H 'Authorization: Bearer <supabase-user-access-token>' \
  -F 'image=@/path/to/fish.jpg'
```

## Hosted Function Deployment

Only deploy this after you are ready to add the first Edge Function to the hosted project:

```sh
supabase functions deploy classify-fish
supabase secrets set OPENAI_API_KEY=your-openai-key
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
```
