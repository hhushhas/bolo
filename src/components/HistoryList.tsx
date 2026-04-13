import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spacing } from '../constants/theme';
import type { Doc } from '../../convex/_generated/dataModel';

export function HistoryList({
  colors,
  entries,
  onSelect,
  selectedEntryId,
}: {
  colors: {
    accent: string;
    border: string;
    danger: string;
    surface: string;
    surfaceStrong: string;
    text: string;
    textSoft: string;
  };
  entries: Doc<'entries'>[];
  onSelect: (entryId: Doc<'entries'>['_id']) => void;
  selectedEntryId: Doc<'entries'>['_id'] | null;
}) {
  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.text }]}>Saved history</Text>
      <Text style={[styles.subtitle, { color: colors.textSoft }]}>
        Reopen any transcript or translation without searching for the link again.
      </Text>

      <View style={styles.list}>
        {entries.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing saved yet</Text>
            <Text style={[styles.emptyCopy, { color: colors.textSoft }]}>
              Your latest transcripts will appear here after the first successful run.
            </Text>
          </View>
        ) : (
          entries.map((entry) => {
            const selected = entry._id === selectedEntryId;
            const badgeColor =
              entry.status === 'failed'
                ? colors.danger
                : entry.status === 'ready'
                  ? colors.accent
                  : colors.textSoft;

            return (
              <Pressable
                key={entry._id}
                onPress={() => onSelect(entry._id)}
                style={[
                  styles.card,
                  {
                    backgroundColor: selected ? colors.surfaceStrong : colors.surface,
                    borderColor: selected ? colors.accent : colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Text numberOfLines={2} style={[styles.cardTitle, { color: colors.text }]}>
                    {entry.title}
                  </Text>
                  <Text style={[styles.badge, { color: badgeColor }]}>
                    {entry.status === 'ready' ? entry.targetLanguageLabel : entry.status}
                  </Text>
                </View>
                <Text style={[styles.meta, { color: colors.textSoft }]}>
                  {entry.sourceLanguageLabel} to {entry.targetLanguageLabel}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: spacing.md,
  },
  cardHeader: {
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  container: {
    gap: 8,
  },
  emptyCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: spacing.lg,
  },
  emptyCopy: {
    fontSize: 15,
    lineHeight: 22,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
  },
  list: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  meta: {
    fontSize: 15,
    lineHeight: 21,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
});
