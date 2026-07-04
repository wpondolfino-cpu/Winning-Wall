# AHS Winning Wall — SQL Migrations (reconstructed history)

Reconstructed from three uploads: `winning_wall_master_setup.sql` (a bundle
containing migrations 002–034), `sql_migrations_june2026.zip` (renumbered
here to 035–040), and a third batch covering personal bests, tutorials,
period anchor, lifting refinements, Workout Groups, Class Clash, and
per-spot personal bests (renumbered to 041–054). Run in numeric order on a
fresh database, then the `data/` files last (they're optional AHS program
content, not schema).

## Numbering logic
The third upload's own README split its files into "Session 4" (personal
bests, tutorials, period anchor, lifting notes/draft mode, multi-spot,
resource URL — 041–049 here) and "New this session" (Class Clash, Workout
Groups, per-spot personal bests, timer/publish date, period snapshots —
050–054 here). Session 4's lifting files reference tables created in
038/039 (`lifting_programs`, `lifting_exercise_bank`), so they had to land
after those — hence the renumbering rather than keeping the original 01–14.

## Previously flagged gaps — now resolved
`tutorials_seen` (047), `spot_personal_bests` (054), `workout_groups` (052),
and Class Clash (`class_clash_competitions`, 050) are all now present and
match what the app code (H2HTab.tsx, PerkTutorial.tsx) actually queries.

## Also resolved since last pass
`001_initial_schema.sql` is now the real original schema (profiles,
workouts, scores, notifications), found on GitHub, and `001b_challenges_table.sql`
is the original `challenges` table, pulled live from Supabase. Every table
the app currently touches now has a migration file behind it. Note:
`001`'s own `leaderboard` view and `profiles.role` check are both superseded
by later migrations (011/024/035 for the view; later admin-role migrations
for the check) — left as-is here for historical accuracy, not because
they're still active.

## Still open
1. **The leaderboard/bonus-points bug is still unresolved.** The view has
   now been "fixed" to include bonus points twice (024, 035) and neither
   apparently stuck for good, per the June README's own note that it
   "should be re-run any time bonus points stop showing." `053_period_snapshots.sql`
   is a separate, unrelated feature (frozen historical leaderboards) —
   it doesn't touch the live bonus-points gap. Still need the *live* view
   definition from Supabase plus the `awardChallengeWinBonus` function body
   to write a fix that actually holds.
3. `044_scoring_cleanup.sql` is a one-time data-repair script, not a
   structural migration — re-check before running against current data,
   since it rewrites `scores.points` in place.

## Naming note
`022b_fix_scores.sql` keeps its original "b" suffix (a same-day follow-up
to 022, not a separately numbered migration).
