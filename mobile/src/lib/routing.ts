import { supabase } from './supabase';

// Mirrors the backend's user_profiles schema. The mobile onboarding screens
// write to this table (not the legacy `profiles` one), and the backend's
// /profile/me endpoint flips `onboarding_complete` to true once the web flow
// finishes — so this single column is the canonical "is onboarded" signal.
export async function getPostAuthRoute(userId: string): Promise<string> {
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select(
        'first_name, last_name, phone, cadre, registration_number, specialties, current_rotation, onboarding_complete',
      )
      .eq('user_id', userId)
      .maybeSingle();

    // Web-onboarded users: trust the explicit flag.
    if (profile?.onboarding_complete) return '/(tabs)/ask';

    // Mobile-onboarded users (or partials): walk the funnel.
    if (!profile?.first_name || !profile?.last_name) return '/onboarding/register';
    if (!profile.phone) return '/onboarding/phone';
    if (!profile.cadre || !profile.registration_number) return '/onboarding/verify';
    if (profile.cadre === 'Intern' && !profile.current_rotation?.length)
      return '/onboarding/rotation';
    if (profile.cadre !== 'Intern' && !profile.specialties?.length)
      return '/onboarding/specialty';

    return '/(tabs)/ask';
  } catch {
    return '/(tabs)/ask';
  }
}
