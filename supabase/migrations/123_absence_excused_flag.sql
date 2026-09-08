-- 123_absence_excused_flag.sql
--
-- Splits "is this player out" from "did I know about it".
--
-- Attendance had one absence value, 'excused', which quietly claimed
-- every absence had been cleared with the coach. It hadn't — unticking
-- someone at 5pm because they called in sick and unticking someone who
-- simply didn't turn up produced identical rows.
--
-- The state is now 'absent'. Whether it was excused is a separate,
-- nullable flag, which keeps the two questions independent: anything
-- asking "is this player out" only looks at override_type and is
-- unaffected by the flag, including the grouping warning on the week
-- list. Add reasons later if you want them; this is deliberately not a
-- taxonomy of sick/injured/academic, because what changes a coach's
-- response is whether they were told, not why.
--
-- Null means "not answered yet" and is the default. Defaulting to
-- unexcused would mark a player because the coach was in a hurry;
-- defaulting to excused would make the flag meaningless. Unanswered is
-- the honest state and can be filled in later.

-- The function below filters on the old value, so it has to be dropped
-- before the check constraint changes underneath it.
drop function if exists public.is_attending_practice(uuid, uuid);

alter table public.practice_attendance_overrides
  drop constraint if exists practice_attendance_overrides_override_type_check;

update public.practice_attendance_overrides
  set override_type = 'absent'
  where override_type = 'excused';

alter table public.practice_attendance_overrides
  add constraint practice_attendance_overrides_override_type_check
  check (override_type in ('call_up', 'absent'));

-- true = excused, false = unexcused, null = not answered.
-- Every row that existed before this migration was entered under a label
-- that said "excused", so that's what they become — even though the label
-- meant something looser at the time.
alter table public.practice_attendance_overrides
  add column if not exists excused boolean;

update public.practice_attendance_overrides
  set excused = true
  where override_type = 'absent' and excused is null;

-- Same function, same behaviour, reading the renamed value.
create or replace function public.is_attending_practice(p_practice_id uuid, p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.practices pr
      join public.profiles pl on pl.id = p_player_id
      where pr.id = p_practice_id
        and pl.home_roster_id = any(pr.roster_ids)
        and not exists (
          select 1 from public.practice_attendance_overrides o
          where o.practice_id = p_practice_id
            and o.player_id = p_player_id
            and o.override_type = 'absent'
        )
    )
    or exists (
      select 1 from public.practice_attendance_overrides o
      where o.practice_id = p_practice_id
        and o.player_id = p_player_id
        and o.override_type = 'call_up'
    );
$$;
