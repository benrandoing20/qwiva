-- =============================================================================
-- Migration 009: Seed handle_new_user from raw_user_meta_data
-- =============================================================================
-- The mobile signup passes first_name/last_name through
-- supabase.auth.signUp({ options: { data: { first_name, last_name } } }), which
-- lands in auth.users.raw_user_meta_data. The previous trigger only used
-- split_part(email, '@', 1) for display_name, leaving the row in a state where
-- subsequent screens (phone/verify/specialty/rotation) had no first/last name
-- written. It also failed for any auth path with no email (phone-only signup),
-- producing a NOT NULL violation on display_name.
--
-- This migration replaces handle_new_user to:
--   - Pull first_name / last_name from raw_user_meta_data when present
--   - Build display_name from first+last, falling back to email-local-part,
--     and finally to 'New User' so the NOT NULL constraint is never violated
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_first TEXT := NULLIF(trim(NEW.raw_user_meta_data ->> 'first_name'), '');
  meta_last  TEXT := NULLIF(trim(NEW.raw_user_meta_data ->> 'last_name'), '');
  email_local TEXT := NULLIF(split_part(coalesce(NEW.email, ''), '@', 1), '');
  resolved_display TEXT;
BEGIN
  resolved_display := coalesce(
    NULLIF(trim(concat_ws(' ', meta_first, meta_last)), ''),
    email_local,
    'New User'
  );

  INSERT INTO public.user_profiles (user_id, display_name, first_name, last_name, country)
  VALUES (NEW.id, resolved_display, meta_first, meta_last, 'Kenya')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
