-- 124_rescue_weekless_practices.sql
--
-- Files any practice that has no week into the one its date belongs to.
--
-- Every listing path filters by week, so a practice with a null week_id
-- exists in the database and appears nowhere in the app. The builder used
-- to offer "No week" as a choice, which is the only way one could have
-- been created deliberately — that option is gone, and createPractice has
-- routed a missing week through week_for_date since migration 115. This
-- clears up anything stranded before either change.
--
-- Nothing has to be invented: week_for_date returns the week containing
-- that date, or creates the right Monday-Sunday week if none covers it.
-- So a rescued practice lands where it would have gone if it had been
-- filed correctly in the first place, not in a bucket labelled "unfiled".

update public.practices
   set week_id = public.week_for_date(practice_date, null),
       updated_at = now()
 where week_id is null;
