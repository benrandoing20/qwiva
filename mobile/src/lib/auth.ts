import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';
import { getPostAuthRoute } from '@/lib/routing';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URL = 'qwiva://auth/callback';

interface SignInResult {
  error: string | null;
  route: string | null;
}

export async function signInWithGoogle(): Promise<SignInResult> {
  try {
    // Step 1: Get the OAuth URL from Supabase, but don't auto-redirect
    const { data: oauthData, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: REDIRECT_URL,
        skipBrowserRedirect: true,
      },
    });

    if (oauthError || !oauthData?.url) {
      return { error: oauthError?.message ?? 'Failed to start Google sign-in.', route: null };
    }

    // Step 2: Open the in-app auth session
    const result = await WebBrowser.openAuthSessionAsync(oauthData.url, REDIRECT_URL);

    if (result.type !== 'success' || !result.url) {
      // User cancelled, dismissed, or something went wrong
      return { error: null, route: null };
    }

    // Step 3: Parse tokens from the redirect URL fragment
    const fragment = result.url.split('#')[1] ?? '';
    const params = new URLSearchParams(fragment);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      return { error: 'Sign-in completed but no session was returned.', route: null };
    }

    // Step 4: Set the Supabase session
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError || !sessionData?.user) {
      return { error: sessionError?.message ?? 'Failed to establish session.', route: null };
    }

    const user = sessionData.user;

    // Step 5: Upsert profile row with name from Google metadata
    // Google provides full_name; split into first + last for our schema
    const fullName = (user.user_metadata?.full_name as string | undefined) ?? '';
    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ');

    if (firstName || lastName) {
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert(
          {
            user_id: user.id,
            first_name: firstName || null,
            last_name: lastName || null,
          },
          { onConflict: 'user_id' }
        );

      if (upsertError) {
        // Profile upsert failed but session is good — don't fail the sign-in.
        // The user can fill in their name later via /onboarding/register if routing falls there.
      }
    }

    // Step 6: Compute next route
    const route = await getPostAuthRoute(user.id);

    return { error: null, route };
  } catch (e: unknown) {
    return {
      error: e instanceof Error ? e.message : 'Something went wrong during Google sign-in.',
      route: null,
    };
  }
}
