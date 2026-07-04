-- 001b_challenges_table.sql
-- Pulled live from Supabase (Database -> Tables -> challenges -> "...")
-- Runs after 001_initial_schema.sql (profiles, workouts) and before
-- 002_challenge_upgrades.sql, which ALTERs this table.

create table public.challenges (
  id uuid not null default extensions.uuid_generate_v4 (),
  challenger_id uuid not null,
  challenger_name text not null,
  opponent_id uuid not null,
  opponent_name text not null,
  workout_id uuid not null,
  workout_title text not null,
  challenger_score integer null default 0,
  opponent_score integer null,
  status text null default 'pending'::text,
  created_at timestamp with time zone null default now(),
  opponent_seen boolean null default false,
  winner_id uuid null,
  constraint challenges_pkey primary key (id),
  constraint challenges_challenger_id_fkey foreign KEY (challenger_id) references profiles (id) on delete CASCADE,
  constraint challenges_opponent_id_fkey foreign KEY (opponent_id) references profiles (id) on delete CASCADE,
  constraint challenges_workout_id_fkey foreign KEY (workout_id) references workouts (id) on delete CASCADE,
  constraint challenges_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'completed'::text,
          'declined'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;
