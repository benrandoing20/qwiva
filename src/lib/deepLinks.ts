import { supabase } from '@/lib/supabase';

interface DeepLinkResult {
  type: 'recovery' | 'oauth_callback' | 'unknown';
  route: string | null;
  error: string | null;
}

/**
 * Parses an incoming deep link URL and handles it appropriately.
 * For password recovery, sets the Supabase session from URL tokens
 * and returns the route the user should land on.
 */
export async function handleDeepLink(url: string): Promise<DeepLinkResult> {
  try {
    // Extract URL fragment (after #)
    const fragmentIndex = url.indexOf('#');
    if (fragmentIndex === -1) {
      return { type: 'unknown', route: null, error: null };
    }

    const fragment = url.substring(fragmentIndex + 1);
    const params = new URLSearchParams(fragment);

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');

    // Password recovery flow
    if (type === 'recovery' && accessToken && refreshToken) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        return {
          type: 'recovery',
          route: null,
          error: 'This reset link has expired. Please request a new one.',
        };
      }

      return {
        type: 'recovery',
        route: '/onboarding/reset-password',
        error: null,
      };
    }

    // OAuth callback (already handled by auth.ts via WebBrowser, but
    // included here for completeness if a future flow needs it)
    if (url.includes('/auth/callback')) {
      return { type: 'oauth_callback', route: null, error: null };
    }

    return { type: 'unknown', route: null, error: null };
  } catch (e: unknown) {
    return {
      type: 'unknown',
      route: null,
      error: e instanceof Error ? e.message : 'Failed to process the link.',
    };
  }
}
