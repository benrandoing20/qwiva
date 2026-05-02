-- =============================================================================
-- Migration 008: Fix handle_new_user trigger search_path
-- =============================================================================
-- The trigger fires as supabase_auth_admin, whose search_path is "auth" (not
-- public). Without an explicit search_path on the function, the unqualified
-- user_profiles reference fails with "relation does not exist", aborting the
-- signup transaction. SECURITY DEFINER does not change search_path on its own.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, display_name, country)
  VALUES (NEW.id, split_part(NEW.email, '@', 1), 'Kenya')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
