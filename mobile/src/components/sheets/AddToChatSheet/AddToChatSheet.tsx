import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Colors, Fonts } from '@/constants';
import { tapHaptic } from '@/lib/haptics';
import { ResponseModeId } from '@/constants/responseModes';
import {
  SheetContainer,
  SheetContainerHandle,
  SheetSnapState,
} from '@/components/sheets/SheetContainer';
import { AttachmentTile } from './AttachmentTile';
import { SecondaryRow } from './SecondaryRow';
import { AddToChatSheetProps } from './types';

export function AddToChatSheet({
  visible,
  responseMode,
  onSelectMode,
  onDismiss,
}: AddToChatSheetProps) {
  const sheetRef = useRef<SheetContainerHandle>(null);
  const [snapState, setSnapState] = useState<SheetSnapState>('collapsed');

  function handleCameraPress() {
    tapHaptic();
    // TODO Sprint 2: open camera (needs expo-camera).
  }

  function handlePhotosPress() {
    tapHaptic();
    // TODO Sprint 2: open photo picker (needs expo-image-picker).
  }

  function handleFilesPress() {
    tapHaptic();
    // TODO Sprint 2: open file picker (needs expo-document-picker).
  }

  function handleAddToProjectPress() {
    tapHaptic();
    // TODO v1.1: project assignment (needs project model).
  }

  function handleToolAccessPress() {
    tapHaptic();
    // TODO v1.1: tool permission UI.
  }

  function handleConnectorsPress() {
    tapHaptic();
    // TODO v1.1: external integrations.
  }

  function handleSeeAllPress() {
    tapHaptic();
    sheetRef.current?.expand();
  }

  return (
    <SheetContainer
      ref={sheetRef}
      visible={visible}
      initialSnapState="collapsed"
      onDismiss={onDismiss}
      onSnapStateChange={setSnapState}
    >
      <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}
        >
          {/* Grabber */}
          <View style={styles.grabberWrap}>
            <View style={styles.grabber} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Add to Chat</Text>
          </View>

          {/* Attachment tiles */}
          <View style={styles.tilesGrid}>
            <AttachmentTile iconName="camera" label="Camera" onPress={handleCameraPress} />
            <AttachmentTile iconName="image" label="Photos" onPress={handlePhotosPress} />
            <AttachmentTile iconName="file-up" label="Files" onPress={handleFilesPress} />
          </View>

          {/* More options link — drag-to-expand affordance, only in collapsed */}
          {snapState === 'collapsed' && (
            <View style={styles.moreOptionsRow}>
              <Pressable onPress={handleSeeAllPress}>
                <Text style={styles.moreOptionsLink}>More options →</Text>
              </Pressable>
            </View>
          )}

          {/* Secondary rows */}
          <View style={styles.secondarySection}>
            <SecondaryRow
              iconName="folder"
              label="Add to project"
              value="None"
              onPress={handleAddToProjectPress}
            />
            <SecondaryRow
              iconName="briefcase"
              label="Tool access"
              value="Auto"
              onPress={handleToolAccessPress}
            />
            {snapState === 'expanded' && (
              <SecondaryRow
                iconName="layout-grid"
                label="Connectors"
                onPress={handleConnectorsPress}
              />
            )}
          </View>
      </ScrollView>
    </SheetContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  grabberWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 100,
    backgroundColor: '#D0D0DC',
  },
  header: {
    paddingTop: 4,
    paddingHorizontal: 22,
    paddingBottom: 14,
    alignItems: 'center',
    position: 'relative',
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  tilesGrid: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  moreOptionsRow: {
    paddingTop: 18,
    paddingHorizontal: 22,
    alignItems: 'flex-end',
  },
  moreOptionsLink: {
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    color: Colors.purple,
    letterSpacing: -0.07,
  },
  secondarySection: {
    marginTop: 18,
    paddingHorizontal: 22,
  },
});
