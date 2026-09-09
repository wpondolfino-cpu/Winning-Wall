-- 126_station_membership.sql
--
-- Lets a station's groups be split out of that station's people instead
-- of the whole practice.
--
-- Groups hang off a drill, and the generator has always split today's
-- attendees. That's right for one drill, and wrong the moment a block
-- holds several: three stations of eight is one drill's groups, but
-- splitting one of those stations into 4v4 is a second drill whose
-- grouping editor offers all twenty-four again.
--
-- A block with more than one drill in a segment IS stations — the app
-- already knows, so it shouldn't have to be told. Station membership is
-- recorded per drill, and the drill's own grouping editor pools from it.
--
-- Deliberately not a new table. A station is a list of people attached to
-- a drill, which is a column; making it a table would imply stations are
-- an entity with a life of their own, and they aren't — they exist for
-- one block of one practice.
--
-- Empty is the default and means what it means today: pool from everyone
-- attending. So every existing practice is unaffected.

alter table public.segment_drills
  add column if not exists station_member_ids uuid[] not null default '{}';

-- Tryout-pool names live in their own id space, same split as
-- segment_drill_groups uses for its members.
alter table public.segment_drills
  add column if not exists station_tryout_member_ids uuid[] not null default '{}';

comment on column public.segment_drills.station_member_ids is
  'Who is at this station. Empty means the drill''s groups pool from everyone attending the practice.';
