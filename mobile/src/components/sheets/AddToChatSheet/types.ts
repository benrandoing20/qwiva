import { ResponseModeId } from '@/constants/responseModes';

export interface AddToChatSheetProps {
  visible: boolean;
  responseMode: ResponseModeId;
  onSelectMode: (id: ResponseModeId) => void;
  onDismiss: () => void;
}

export interface AttachmentTileProps {
  iconName: 'camera' | 'image' | 'file-up';
  label: string;
  onPress: () => void;
}

export interface ActiveModeCardProps {
  modeId: ResponseModeId;
  onPress: () => void;
}

export interface ModeChipProps {
  modeId: ResponseModeId;
  onPress: () => void;
}

export interface ModePickerRowProps {
  modeId: ResponseModeId;
  isSelected: boolean;
  onPress: () => void;
}

export interface SecondaryRowProps {
  iconName: 'folder' | 'briefcase' | 'layout-grid';
  label: string;
  value?: string;
  onPress: () => void;
}
