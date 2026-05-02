import { ReactNode } from 'react';

export interface SidebarItem {
  id: string;
  label: string;
}

export interface SidebarRecent extends SidebarItem {
  timestamp: string;
}

export interface SidebarContextValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: boolean;
}

export interface SidebarShellProps {
  children: ReactNode;
}
