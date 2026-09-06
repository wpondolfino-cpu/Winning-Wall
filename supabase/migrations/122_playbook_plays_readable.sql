-- 122_playbook_plays_readable.sql
--
-- A player assigned a playbook could open it and see the right number of
-- rows with nothing in them.
--
-- The plays table had exactly two read policies: you own it
-- (plays_owner_all), or it was shared with you directly via play_shares
-- (plays_shared_read). Neither covers "it's in a playbook shared with
-- me". So the playbook read fine, the playbook_plays join rows read fine
-- — and the join through to plays(*) returned null for every one of
-- them, because RLS filtered them out one level down.
--
-- Same reason the playbook's print view came out empty for that player.
--
-- Mirrors playbook_plays_player_read, which already allows exactly this
-- shape of access to the join table. The playbook still has to be active:
-- a draft playbook shouldn't expose its plays any more than it exposes
-- itself.

drop policy if exists "plays_playbook_read" on public.plays;
create policy "plays_playbook_read" on public.plays
  for select using (
    exists (
      select 1
      from public.playbook_plays pp
      join public.playbooks pb on pb.id = pp.playbook_id
      join public.playbook_shares ps on ps.playbook_id = pb.id
      where pp.play_id = plays.id
        and ps.shared_with = auth.uid()
        and pb.status = 'active'
    )
  );

-- Supports the lookup above, which starts from the play.
create index if not exists playbook_plays_play_id_idx
  on public.playbook_plays(play_id);
