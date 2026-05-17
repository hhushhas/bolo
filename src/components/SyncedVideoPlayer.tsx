import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '../constants/theme';
import { buildDebugReportText, type DisplayTranscriptSegment, type ProcessingDebugReport } from '../lib/syncedTranscript';

type LandscapeMode = 'split' | 'overlay';

type SyncedVideoPlayerProps = {
  activeMs: number;
  colors: {
    accent: string;
    background: string;
    backgroundAccent: string;
    border: string;
    info: string;
    reader: string;
    surface: string;
    text: string;
    textSoft: string;
  };
  debugReport?: ProcessingDebugReport;
  onSeek: (timeMs: number) => void;
  segments: DisplayTranscriptSegment[];
  videoSlot?: React.ReactNode;
};

const formatClock = (timeMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function SyncedVideoPlayer({
  activeMs,
  colors,
  debugReport,
  onSeek,
  segments,
  videoSlot,
}: SyncedVideoPlayerProps) {
  const { height, width } = useWindowDimensions();
  const [debugVisible, setDebugVisible] = useState(false);
  const [landscapeMode, setLandscapeMode] = useState<LandscapeMode>('split');
  const scrollRef = useRef<ScrollView | null>(null);
  const landscape = width > height;
  const activeSegmentIndex = Math.max(
    0,
    segments.findIndex((segment) => activeMs >= segment.startMs && activeMs < segment.endMs),
  );

  const debugText = useMemo(
    () => (debugReport ? buildDebugReportText(debugReport) : ''),
    [debugReport],
  );
  const overlaySegments = useMemo(
    () => segments.slice(activeSegmentIndex, activeSegmentIndex + 2),
    [activeSegmentIndex, segments],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      animated: true,
      y: Math.max(0, activeSegmentIndex * (landscape ? 74 : 92) - 24),
    });
  }, [activeSegmentIndex, landscape]);

  const renderSegment = (segment: DisplayTranscriptSegment, index: number) => {
    const active = index === activeSegmentIndex;

    return (
      <Pressable
        key={`${segment.index}-${segment.startMs}`}
        onPress={() => onSeek(segment.startMs)}
        style={[
          styles.segment,
          {
            backgroundColor: active ? colors.backgroundAccent : 'transparent',
            borderColor: active ? colors.accent : colors.border,
            borderLeftColor: active ? colors.accent : 'transparent',
          },
        ]}
      >
        <Text style={[styles.segmentTime, { color: active ? colors.accent : colors.textSoft }]}>
          {formatClock(segment.startMs)}
        </Text>
        <Text style={[styles.translationText, { color: colors.text }]}>
          {segment.translatedText || segment.originalText}
        </Text>
      </Pressable>
    );
  };

  const player = (
    <View style={[styles.playerPanel, { backgroundColor: colors.background }]}>
      {videoSlot ?? (
        <View style={[styles.videoPlaceholder, { backgroundColor: colors.backgroundAccent }]}>
          <MaterialCommunityIcons name="youtube" size={48} color={colors.accent} />
          <Text style={[styles.videoPlaceholderText, { color: colors.text }]}>YouTube Player</Text>
        </View>
      )}
    </View>
  );

  const layoutToggle = landscape ? (
    <Pressable
      accessibilityLabel={landscapeMode === 'split' ? 'Show translation over video' : 'Show translation beside video'}
      onPress={() => setLandscapeMode((current) => (current === 'split' ? 'overlay' : 'split'))}
      style={[styles.layoutToggle, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <MaterialCommunityIcons
        name={landscapeMode === 'split' ? 'image-text' : 'view-split-vertical'}
        size={22}
        color={colors.text}
      />
    </Pressable>
  ) : null;

  const overlayCaption = landscape && landscapeMode === 'overlay' ? (
    <View style={styles.overlayCaptionWrap} pointerEvents="box-none">
      <View style={styles.overlayCaptionPanel}>
        {overlaySegments.map((segment, index) => (
          <Pressable
            key={`${segment.index}-${segment.startMs}-overlay`}
            onPress={() => onSeek(segment.startMs)}
            style={index === 0 ? styles.overlayActiveSegment : styles.overlayNextSegment}
          >
            <Text style={[styles.overlayTime, { color: index === 0 ? colors.accent : '#d9d0a7' }]}>
              {formatClock(segment.startMs)}
            </Text>
            <Text
              numberOfLines={index === 0 ? 2 : 1}
              style={[styles.overlayText, { color: colors.reader, opacity: index === 0 ? 1 : 0.82 }]}
            >
              {segment.translatedText || segment.originalText}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  const transcript = (
    <View style={styles.transcriptPanel}>
      {debugReport ? (
        <View style={styles.infoRow}>
          <Pressable
            onPress={() => setDebugVisible(true)}
            style={[styles.infoButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <MaterialCommunityIcons name="information-outline" size={22} color={colors.text} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView ref={scrollRef} contentContainerStyle={styles.segmentList} showsVerticalScrollIndicator={false}>
        {segments.map(renderSegment)}
      </ScrollView>
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        landscape ? styles.landscapeContainer : styles.portraitContainer,
        { backgroundColor: colors.background },
      ]}
    >
      {landscape && landscapeMode === 'overlay' ? (
        <View style={styles.overlayPlayer}>
          {player}
          {layoutToggle}
          {debugReport ? (
            <Pressable
              onPress={() => setDebugVisible(true)}
              style={[styles.overlayInfoButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <MaterialCommunityIcons name="information-outline" size={22} color={colors.text} />
            </Pressable>
          ) : null}
          {overlayCaption}
        </View>
      ) : landscape ? (
        <>
          <View style={styles.landscapePlayer}>
            {player}
            {layoutToggle}
          </View>
          <View style={styles.landscapeTranscript}>{transcript}</View>
        </>
      ) : (
        <>
          {player}
          {transcript}
        </>
      )}

      <Modal transparent animationType="fade" visible={debugVisible}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.debugSheet, { backgroundColor: colors.reader, borderColor: colors.border }]}>
            <View style={styles.titleRow}>
              <Text style={[styles.debugTitle, { color: colors.text }]}>Processing Info</Text>
              <Pressable onPress={() => setDebugVisible(false)} style={styles.closeButton}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.debugScroll}>
              <Text selectable style={[styles.debugText, { color: colors.text }]}>
                {debugText}
              </Text>
            </ScrollView>
            <Pressable
              onPress={() => Clipboard.setStringAsync(debugText)}
              style={[styles.copyButton, { backgroundColor: colors.info, borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="content-copy" size={20} color="#fff" />
              <Text style={styles.copyButtonText}>Copy debug report</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  compactButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  compactButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  container: {
    flex: 1,
    gap: spacing.xs,
  },
  copyButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 58,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
  },
  debugScroll: {
    maxHeight: 320,
  },
  debugSheet: {
    borderRadius: 20,
    borderWidth: 3,
    gap: spacing.md,
    maxWidth: 560,
    padding: spacing.md,
    width: '92%',
  },
  debugText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 23,
  },
  debugTitle: {
    fontSize: 24,
    fontWeight: '900',
  },
  infoButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 44,
  },
  landscapeContainer: {
    flexDirection: 'row',
    padding: spacing.xs,
  },
  landscapePlayer: {
    flex: 1.25,
    position: 'relative',
  },
  landscapeTranscript: {
    flex: 1,
  },
  layoutToggle: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
    width: 42,
    zIndex: 3,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  playerPanel: {
    gap: spacing.xs,
    overflow: 'hidden',
  },
  overlayActiveSegment: {
    gap: 3,
  },
  overlayCaptionPanel: {
    backgroundColor: 'rgba(24, 25, 25, 0.82)',
    borderRadius: 8,
    gap: 8,
    maxWidth: 720,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    width: '86%',
  },
  overlayCaptionWrap: {
    alignItems: 'center',
    bottom: 54,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 2,
  },
  overlayInfoButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs + 48,
    width: 42,
    zIndex: 3,
  },
  overlayNextSegment: {
    gap: 2,
  },
  overlayPlayer: {
    flex: 1,
    position: 'relative',
  },
  overlayText: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  overlayTime: {
    fontSize: 12,
    fontWeight: '900',
  },
  portraitContainer: {
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
  },
  segment: {
    borderLeftWidth: 4,
    borderRadius: 8,
    borderWidth: 0,
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  segmentList: {
    gap: 4,
    paddingBottom: spacing.lg,
  },
  segmentTime: {
    fontSize: 12,
    fontWeight: '900',
  },
  smallControlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  toolbarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  transcriptPanel: {
    flex: 1,
    gap: spacing.xs,
    minHeight: 0,
    paddingHorizontal: spacing.sm,
  },
  translationText: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 29,
  },
  videoPlaceholder: {
    alignItems: 'center',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    gap: 6,
    justifyContent: 'center',
    width: '100%',
  },
  videoPlaceholderText: {
    fontSize: 18,
    fontWeight: '900',
  },
});
