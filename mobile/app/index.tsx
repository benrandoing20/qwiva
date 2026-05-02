import { useEffect } from 'react';
import { router } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { getPostAuthRoute } from '../src/lib/routing';

export default function Index() {
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace('/onboarding/login');
        return;
      }
      const route = await getPostAuthRoute(session.user.id);
      router.replace(route as `/${string}`);
    });
  }, []);

  return null;
}
