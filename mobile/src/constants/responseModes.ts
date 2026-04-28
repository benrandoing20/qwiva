import { LucideIcon } from 'lucide-react-native';
import {
  Sparkles,
  ClipboardList,
  GraduationCap,
  Stethoscope,
} from 'lucide-react-native';

export type ResponseModeId = 'default' | 'ward' | 'study' | 'consult';

export interface ResponseMode {
  id: ResponseModeId;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const RESPONSE_MODES: ResponseMode[] = [
  {
    id: 'default',
    label: 'Default',
    icon: Sparkles,
    description: 'General clinical Q&A',
  },
  {
    id: 'ward',
    label: 'Ward round',
    icon: ClipboardList,
    description: 'Bedside-paced, action-first',
  },
  {
    id: 'study',
    label: 'Study',
    icon: GraduationCap,
    description: 'Tutor mode with quick recap',
  },
  {
    id: 'consult',
    label: 'Consult',
    icon: Stethoscope,
    description: 'Specialist 2nd-opinion w/ refs',
  },
];

export function getResponseMode(id: ResponseModeId): ResponseMode {
  return RESPONSE_MODES.find((m) => m.id === id) ?? RESPONSE_MODES[0];
}
