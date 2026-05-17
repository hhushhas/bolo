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
  topLeftControls?: React.ReactNode;
  topRightControls?: React.ReactNode;
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
  topLeftControls,
  topRightControls,
  videoSlot,
}: SyncedVideoPlayerProps) {
  const { height, width } = useWindowDimensions();
  const [debugVisible, setDebugVisible] = useState(false);
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

  const transcript = (
    <View style={styles.transcriptPanel}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.segmentList} showsVerticalScrollIndicator={false}>
        {segments.map(renderSegment)}
      </ScrollView>
    </View>
  );

  const controlRow = (
    <View style={styles.controlRow}>
      <View>{topLeftControls}</View>
      <View style={styles.controlRowRight}>
        {topRightControls}
        {debugReport ? (
          <Pressable
            onPress={() => setDebugVisible(true)}
            style={[styles.controlIconButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <MaterialCommunityIcons name="information-outline" size={20} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
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
      {landscape ? (
        <>
          <View style={styles.landscapePlayer}>{player}</View>
          <View style={styles.landscapeTranscript}>
            {controlRow}
            {transcript}
          </View>
        </>
      ) : (
        <>
          {controlRow}
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
  container: {
    flex: 1,
  },
  controlIconButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  controlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  controlRowRight: {
    flexDirection: 'row',
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
  landscapeContainer: {
    flexDirection: 'row',
  },
  landscapePlayer: {
    flex: 1.3,
    minWidth: 0,
  },
  landscapeTranscript: {
    flex: 1,
    minWidth: 0,
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
  portraitContainer: {
    paddingHorizontal: 0,
  },
  segment: {
    borderLeftWidth: 4,
    borderRadius: 6,
    borderWidth: 0,
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  segmentList: {
    gap: 2,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  segmentTime: {
    fontSize: 12,
    fontWeight: '900',
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  transcriptPanel: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.sm,
  },
  translationText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
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
