import { ReactNode } from 'react';

export type SheetSnapState = 'collapsed' | 'expanded';

export interface SheetSnapPoint {
  id: SheetSnapState;
  /** Height as fraction of screen (0-1). e.g., 0.62 = 62% visible. */
  heightFraction: number;
}

export interface SheetContainerProps {
  /** Whether sheet is mounted/visible */
  visible: boolean;
  /** Initial snap state when sheet first becomes visible */
  initialSnapState?: SheetSnapState;
  /** Snap point configuration */
  snapPoints?: SheetSnapPoint[];
  /** Called when sheet should dismiss */
  onDismiss: () => void;
  /** Called when snap state changes (e.g., expanded → collapsed) */
  onSnapStateChange?: (state: SheetSnapState) => void;
  /** Sheet content */
  children: ReactNode;
  /** Optional override snap state (forces re-snap) */
  forceSnapState?: SheetSnapState;
}

export interface SheetContainerHandle {
  collapse: () => void;
  expand: () => void;
  dismiss: () => void;
  getCurrentSnapState: () => SheetSnapState;
}
