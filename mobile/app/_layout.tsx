import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useQwivaFonts } from '../src/hooks/useFonts';
import { supabase } from '../src/lib/supabase';
import { handleDeepLink } from '../src/lib/deepLinks';
import { ThemeProvider, useThemeMode } from '../src/contexts/ThemeContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { loaded, error } = useQwivaFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/onboarding/login');
    });
    return () => subscription.unsubscribe();
  }, []);

  // Deep link handler for password recovery and other auth flows
  useEffect(() => {
    // Handle URL when app is already open
    const subscription = Linking.addEventListener('url', async ({ url }) => {
      const result = await handleDeepLink(url);
      if (result.route) {
        router.replace(result.route as `/${string}`);
      }
    });

    // Handle URL when app is opened from a closed state
    (async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        const result = await handleDeepLink(initialUrl);
        if (result.route) {
          router.replace(result.route as `/${string}`);
        }
      }
    })();

    return () => {
      subscription.remove();
    };
  }, []);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ThemedShell />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function ThemedShell() {
  const { scheme } = useThemeMode();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="case" options={{ presentation: 'card' }} />
        <Stack.Screen name="surveys/[id]" options={{ presentation: 'card' }} />
      </Stack>
    </>
  );
}
