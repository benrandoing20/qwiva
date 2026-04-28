import { supabase } from './supabase';

export async function getPostAuthRoute(userId: string): Promise<string> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, phone, cadre, registration_number, specialties, current_rotation')
      .eq('id', userId)
      .single();

    if (!profile?.first_name || !profile?.last_name) return '/onboarding/register';
    if (!profile.phone) return '/onboarding/phone';
    if (!profile.cadre || !profile.registration_number) return '/onboarding/verify';
    if (profile.cadre === 'Intern' && !profile.current_rotation?.length) return '/onboarding/rotation';
    if (profile.cadre !== 'Intern' && !profile.specialties?.length) return '/onboarding/specialty';

    return '/(tabs)/ask';
  } catch {
    return '/(tabs)/ask';
  }
}
