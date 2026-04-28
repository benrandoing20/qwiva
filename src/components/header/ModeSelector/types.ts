import { ResponseModeId } from '@/constants/responseModes';

export interface ModeSelectorPillProps {
  modeId: ResponseModeId;
  isOpen: boolean;
  onPress: () => void;
}

export interface ModeDropdownProps {
  selectedModeId: ResponseModeId;
  onSelectMode: (id: ResponseModeId) => void;
  adaptiveThinking: boolean;
  onToggleAdaptiveThinking: () => void;
  onDismiss: () => void;
}

export interface AdaptiveThinkingRowProps {
  enabled: boolean;
  onToggle: () => void;
}
