import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '../constants/theme';
import type { Doc } from '../../convex/_generated/dataModel';

export function ResultReader({
  activeView,
  colors,
  entry,
  onChangeView,
  onCopy,
  onShare,
}: {
  activeView: 'transcript' | 'translation';
  colors: {
    accent: string;
    border: string;
    danger: string;
    reader: string;
    surface: string;
    text: string;
    textSoft: string;
  };
  entry: Doc<'entries'> | null;
  onChangeView: (value: 'transcript' | 'translation') => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  if (!entry) {
    return (
      <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Your reading area</Text>
        <Text style={[styles.emptyCopy, { color: colors.textSoft }]}>
          Once a transcript is ready, it will appear here in a clean, easy-to-read layout.
        </Text>
      </View>
    );
  }

  const content = activeView === 'translation' ? entry.translationText : entry.transcriptText;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.heading, { color: colors.text }]}>Reader</Text>
          <Text style={[styles.subtitle, { color: colors.textSoft }]}>
            Tap the buttons below to switch views, copy, or share on WhatsApp.
          </Text>
        </View>
        <View style={styles.toggleRow}>
          {(['transcript', 'translation'] as const).map((view) => (
            <Pressable
              key={view}
              onPress={() => onChangeView(view)}
              style={[
                styles.toggle,
                {
                  backgroundColor: activeView === view ? colors.accent : colors.surface,
                  borderColor: activeView === view ? colors.accent : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.toggleText,
                  { color: activeView === view ? colors.reader : colors.text },
                ]}
              >
                {view === 'transcript' ? 'Transcript' : 'Translation'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.readerCard, { backgroundColor: colors.reader, borderColor: colors.border }]}>
        {entry.status === 'failed' ? (
          <>
            <Text style={[styles.errorTitle, { color: colors.danger }]}>This video could not be processed</Text>
            <Text style={[styles.readerText, { color: colors.text }]}>
              {entry.errorMessage ?? 'Please try another YouTube link.'}
            </Text>
          </>
        ) : entry.status !== 'ready' ? (
          <>
            <Text style={[styles.waitingTitle, { color: colors.text }]}>Working on it...</Text>
            <Text style={[styles.readerText, { color: colors.textSoft }]}>
              We are preparing the transcript and translation for this video.
            </Text>
          </>
        ) : (
          <Text style={[styles.readerText, { color: colors.text }]}>
            {content ?? 'Nothing to show yet.'}
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={onCopy} style={[styles.action, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialCommunityIcons color={colors.text} name="content-copy" size={18} />
          <Text style={[styles.actionLabel, { color: colors.text }]}>Copy text</Text>
        </Pressable>
        <Pressable onPress={onShare} style={[styles.action, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialCommunityIcons color="#25D366" name="whatsapp" size={18} />
          <Text style={[styles.actionLabel, { color: colors.text }]}>WhatsApp share</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  container: {
    gap: spacing.md,
  },
  emptyCopy: {
    fontSize: 16,
    lineHeight: 24,
  },
  emptyState: {
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  header: {
    gap: spacing.sm,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  readerCard: {
    borderRadius: 28,
    borderWidth: 1,
    minHeight: 260,
    padding: spacing.xl,
  },
  readerText: {
    fontSize: 19,
    lineHeight: 31,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  toggle: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '700',
  },
  waitingTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
});
