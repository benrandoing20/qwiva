import { useFonts as useExpoFonts } from 'expo-font';
import {
  Lora_400Regular_Italic,
  Lora_600SemiBold,
  Lora_700Bold,
} from '@expo-google-fonts/lora';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';

export function useQwivaFonts() {
  const [loaded, error] = useExpoFonts({
    Lora_700Bold,
    Lora_600SemiBold,
    Lora_400Regular_Italic,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    'Gilroy-Light': require('../../assets/Gilroy-Light.ttf'),
    'Gilroy-SemiBold': require('../../assets/Gilroy-SemiBold.ttf'),
    'Gotham-Thin': require('../../assets/Gotham-Thin.otf'),
    'Gotham-Light': require('../../assets/Gotham-Light.otf'),
    'Gotham-Book': require('../../assets/Gotham-Book.otf'),
    'Gotham-Medium': require('../../assets/Gotham-Medium.otf'),
    'Gotham-Bold': require('../../assets/Gotham-Bold.otf'),
    'Gotham-Black': require('../../assets/Gotham-Black.otf'),
    'Gotham-Ultra': require('../../assets/Gotham-Ultra.otf'),
  });

  return { loaded, error };
}
