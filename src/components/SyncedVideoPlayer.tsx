import { useMemo, useState } from 'react';
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

type PlayerMode = 'bilingual' | 'original' | 'translation';

type SyncedVideoPlayerProps = {
  activeMs: number;
  autoScrollEnabled: boolean;
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
  durationMs: number;
  isPlaying: boolean;
  mode: PlayerMode;
  onChangeMode: (mode: PlayerMode) => void;
  onSeek: (timeMs: number) => void;
  onSeekBy: (offsetMs: number) => void;
  onToggleAutoScroll: () => void;
  onTogglePlaying: () => void;
  playbackRate: number;
  segments: DisplayTranscriptSegment[];
  setPlaybackRate: (rate: number) => void;
  title: string;
  videoSlot?: React.ReactNode;
};

const formatClock = (timeMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const playbackRates = [0.75, 1, 1.25, 1.5] as const;

export function SyncedVideoPlayer({
  activeMs,
  autoScrollEnabled,
  colors,
  debugReport,
  durationMs,
  isPlaying,
  mode,
  onChangeMode,
  onSeek,
  onSeekBy,
  onToggleAutoScroll,
  onTogglePlaying,
  playbackRate,
  segments,
  setPlaybackRate,
  title,
  videoSlot,
}: SyncedVideoPlayerProps) {
  const { height, width } = useWindowDimensions();
  const [debugVisible, setDebugVisible] = useState(false);
  const landscape = width > height;
  const activeSegmentIndex = Math.max(
    0,
    segments.findIndex((segment) => activeMs >= segment.startMs && activeMs < segment.endMs),
  );

  const debugText = useMemo(
    () => (debugReport ? buildDebugReportText(debugReport) : ''),
    [debugReport],
  );

  const renderModeButton = (nextMode: PlayerMode, label: string) => {
    const selected = mode === nextMode;

    return (
      <Pressable
        onPress={() => onChangeMode(nextMode)}
        style={[
          styles.modeButton,
          {
            backgroundColor: selected ? colors.accent : colors.surface,
            borderColor: selected ? colors.accent : colors.border,
          },
        ]}
      >
        <Text style={[styles.modeButtonText, { color: selected ? colors.reader : colors.text }]}>
          {label}
        </Text>
      </Pressable>
    );
  };

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
        {mode !== 'translation' ? (
          <Text style={[styles.originalText, { color: colors.text }]}>
            {segment.originalText}
          </Text>
        ) : null}
        {mode !== 'original' ? (
          <Text style={[styles.translationText, { color: colors.text }]}>
            {segment.translatedText || segment.originalText}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const player = (
    <View style={[styles.playerPanel, { backgroundColor: colors.reader, borderColor: colors.border }]}>
      {videoSlot ?? (
        <View style={[styles.videoPlaceholder, { backgroundColor: colors.backgroundAccent }]}>
          <MaterialCommunityIcons name="youtube" size={48} color={colors.accent} />
          <Text style={[styles.videoPlaceholderText, { color: colors.text }]}>YouTube Player</Text>
        </View>
      )}

      <View style={styles.progressRow}>
        <Text style={[styles.clockText, { color: colors.textSoft }]}>{formatClock(activeMs)}</Text>
        <View style={[styles.progressTrack, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.accent,
                width: `${Math.min(100, Math.max(0, (activeMs / Math.max(1, durationMs)) * 100))}%`,
              },
            ]}
          />
        </View>
        <Text style={[styles.clockText, { color: colors.textSoft }]}>{formatClock(durationMs)}</Text>
      </View>

      <View style={styles.controlRow}>
        <Pressable onPress={() => onSeekBy(-10_000)} style={[styles.iconButton, { borderColor: colors.border }]}>
          <MaterialCommunityIcons name="rewind-10" size={26} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={onTogglePlaying}
          style={[styles.playButton, { backgroundColor: colors.accent, borderColor: colors.border }]}
        >
          <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={30} color="#fff" />
        </Pressable>
        <Pressable onPress={() => onSeekBy(10_000)} style={[styles.iconButton, { borderColor: colors.border }]}>
          <MaterialCommunityIcons name="fast-forward-10" size={26} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );

  const transcript = (
    <View style={styles.transcriptPanel}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSoft }]}>
            {segments.length} synced segments
          </Text>
        </View>
        {debugReport ? (
          <Pressable
            onPress={() => setDebugVisible(true)}
            style={[styles.infoButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <MaterialCommunityIcons name="information-outline" size={22} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.toolbarRow}>
        <View style={styles.modeRow}>
          {renderModeButton('bilingual', 'Bilingual')}
          {renderModeButton('original', 'Original')}
          {renderModeButton('translation', 'Translation')}
        </View>

        <View style={styles.smallControlsRow}>
          <Pressable
            onPress={onToggleAutoScroll}
            style={[styles.compactButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <MaterialCommunityIcons
              name={autoScrollEnabled ? 'format-vertical-align-center' : 'gesture-swipe-vertical'}
              size={18}
              color={colors.text}
            />
            <Text style={[styles.compactButtonText, { color: colors.text }]}>
              Auto-scroll {autoScrollEnabled ? 'on' : 'off'}
            </Text>
          </Pressable>

          <View style={styles.rateRow}>
            {playbackRates.map((rate) => {
              const selected = playbackRate === rate;

              return (
                <Pressable
                  key={rate}
                  onPress={() => setPlaybackRate(rate)}
                  style={[
                    styles.rateButton,
                    {
                      backgroundColor: selected ? colors.accent : colors.surface,
                      borderColor: selected ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.rateText, { color: selected ? colors.reader : colors.text }]}>
                    {rate}x
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.segmentList} showsVerticalScrollIndicator={false}>
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
      {landscape ? (
        <>
          <View style={styles.landscapePlayer}>{player}</View>
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
  clockText: {
    fontSize: 15,
    fontWeight: '800',
    minWidth: 48,
    textAlign: 'center',
  },
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
    gap: spacing.sm,
  },
  controlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
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
  iconButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    width: 50,
  },
  infoButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  landscapeContainer: {
    flexDirection: 'row',
    padding: spacing.sm,
  },
  landscapePlayer: {
    flex: 1.15,
  },
  landscapeTranscript: {
    flex: 1,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 112,
    paddingHorizontal: 8,
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
  modeRow: {
    flexDirection: 'row',
    flexGrow: 1,
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  originalText: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 26,
  },
  playButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 3,
    height: 48,
    justifyContent: 'center',
    width: 60,
  },
  playerPanel: {
    borderRadius: 20,
    borderWidth: 3,
    gap: spacing.sm,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  portraitContainer: {
    padding: spacing.md,
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  progressTrack: {
    borderRadius: 999,
    borderWidth: 2,
    flex: 1,
    height: 14,
    overflow: 'hidden',
  },
  rateButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 2,
    minHeight: 36,
    minWidth: 52,
    justifyContent: 'center',
  },
  rateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  rateText: {
    fontSize: 15,
    fontWeight: '900',
  },
  segment: {
    borderLeftWidth: 6,
    borderRadius: 16,
    borderWidth: 0,
    gap: 6,
    padding: spacing.sm,
  },
  segmentList: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  segmentTime: {
    fontSize: 15,
    fontWeight: '900',
  },
  smallControlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 26,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
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
    gap: spacing.sm,
    minHeight: 0,
  },
  translationText: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 27,
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
