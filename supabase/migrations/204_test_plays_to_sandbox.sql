-- 204_test_plays_to_sandbox.sql
-- Moves the four TEST plays and the TEST Quiz Playbook out of AHS Boys
-- into the sandbox, and keeps them there through every Reset -- the same
-- as ZZ Tigers. Picked by their exact ids (from find_test_plays.sql), so
-- nothing else can be caught by accident.
--
--   TEST Horns Flare, TEST Chicago, TEST Box BLOB, TEST Stack BLOB
--   TEST Quiz Playbook (and which plays are in it)
--
-- Each play's "play call" (the copy the game tracker and reports use) moves
-- with it -- unless a Boys game's tracked stats used it, in which case it
-- stays in Boys for those stats and just stops pointing at the play.
-- Run 198 (and ideally 200) first. Safe to run again.

begin;

do $$
declare
  v_boys uuid := public.legacy_default_program_id();
  v_sb   uuid := public.sandbox_program_id();
  v_plays uuid[] := array[
    '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000011',
    '00000000-0000-4000-a000-000000000012', '00000000-0000-4000-a000-000000000013']::uuid[];
  v_book uuid := '00000000-0000-4000-a000-000000000004';
  pl uuid[]; calls uuid[]; used uuid[];
begin
  if v_sb is null then raise exception 'Run 198 (the sandbox) first.'; end if;
  if to_regclass('public.sandbox_keep') is null then
    create table public.sandbox_keep (
      table_name text not null, key_column text not null default 'id', row_id uuid not null,
      added_at timestamptz not null default now(), primary key (table_name, row_id));
    alter table public.sandbox_keep enable row level security;
    revoke all on public.sandbox_keep from anon, authenticated;
  end if;

  -- Only the ones still in Boys.
  select coalesce(array_agg(id), '{}') into pl from public.plays where id = any(v_plays) and program_id = v_boys;
  if cardinality(pl) = 0 and not exists (select 1 from public.playbooks where id = v_book and program_id = v_boys) then
    raise notice 'The TEST plays and playbook are no longer in AHS Boys. Nothing changed.';
    return;
  end if;

  -- Play calls mirroring these plays; keep any a Boys game's stats used.
  select coalesce(array_agg(id), '{}') into calls from public.play_calls where linked_play_id = any(pl) and program_id = v_boys;
  select coalesce(array_agg(distinct c), '{}') into used from (
    select play_call_id as c from public.possessions where program_id = v_boys and play_call_id = any(calls)
    union select press_break_type_id from public.possessions where program_id = v_boys and press_break_type_id = any(calls)) x
   where c is not null;
  update public.play_calls set linked_play_id = null where id = any(used);
  update public.play_calls set program_id = v_sb where id = any(calls) and not (id = any(used));

  -- A Boys team drill linked to one of these plays just loses the link.
  update public.practice_drills_library set linked_play_id = null
   where program_id = v_boys and linked_play_id = any(pl);

  -- Move the playbook, its play list, and the plays (with any shares).
  update public.playbooks       set program_id = v_sb where id = v_book and program_id = v_boys;
  update public.playbook_plays  set program_id = v_sb where playbook_id = v_book;
  update public.playbook_shares set program_id = v_sb where playbook_id = v_book;
  update public.plays           set program_id = v_sb where id = any(pl);
  update public.play_shares     set program_id = v_sb where play_id = any(pl);
  -- A Boys playbook that also listed one of these plays drops it.
  delete from public.playbook_plays where play_id = any(pl) and program_id = v_boys;

  -- Kept through every Reset.
  insert into public.sandbox_keep (table_name, row_id)
  select 'plays', unnest(pl) union all
  select 'playbooks', id from public.playbooks where id = v_book and program_id = v_sb union all
  select 'play_calls', id from public.play_calls where id = any(calls) and program_id = v_sb
  on conflict do nothing;
  -- The playbook's play list has no id of its own; it's kept by play.
  insert into public.sandbox_keep (table_name, key_column, row_id)
  select 'playbook_plays', 'play_id', play_id from public.playbook_plays where playbook_id = v_book
  on conflict do nothing;

  perform public._plog('Moved TEST plays to the sandbox', null, v_sb,
    cardinality(pl) || ' play(s) and the TEST Quiz Playbook');
end $$;

-- Self-check: nothing left in Boys.
do $$
begin
  if exists (select 1 from public.plays where program_id = public.legacy_default_program_id() and id in (
               '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000011',
               '00000000-0000-4000-a000-000000000012', '00000000-0000-4000-a000-000000000013'))
     or exists (select 1 from public.playbooks where program_id = public.legacy_default_program_id()
                 and id = '00000000-0000-4000-a000-000000000004') then
    raise exception 'Self-check: a TEST play or the TEST playbook is still in AHS Boys. Rolled back.';
  end if;
end $$;

commit;

select (select count(*) from public.plays where program_id = public.sandbox_program_id() and title ilike 'test%') as test_plays_in_sandbox,
       (select count(*) from public.playbooks where program_id = public.sandbox_program_id() and name ilike 'test%') as test_playbooks_in_sandbox,
       (select count(*) from public.sandbox_keep) as kept_through_resets;
