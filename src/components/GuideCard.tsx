import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing } from '../constants/theme';

export function GuideCard({
  colors,
}: {
  colors: {
    accent: string;
    accentStrong: string;
    border: string;
    surface: string;
    text: string;
    textSoft: string;
  };
}) {
  return (
    <LinearGradient
      colors={[colors.accent, colors.accentStrong]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.hero}
    >
      <Text style={styles.eyebrow}>How it works</Text>
      <Text style={styles.title}>Paste. Preview. Transcribe. Share.</Text>
      <Text style={styles.subtitle}>
        This screen is built to feel calm and obvious, even on a first try.
      </Text>

      <View style={[styles.steps, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {[
          'Paste a YouTube video or Shorts link.',
          'Check the thumbnail and title before you continue.',
          'Read, copy, or share the transcript and translation.',
        ].map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <View style={[styles.stepBadge, { backgroundColor: colors.accentStrong }]}>
              <Text style={styles.stepBadgeText}>{index + 1}</Text>
            </View>
            <Text style={[styles.stepText, { color: colors.text }]}>{step}</Text>
          </View>
        ))}
        <Text style={[styles.helpText, { color: colors.textSoft }]}>
          Tip: the translation uses your chosen target language, and the result stays saved in your history.
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 28,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  eyebrow: {
    color: '#fff9e8',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fffdf5',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  subtitle: {
    color: '#fff6db',
    fontSize: 17,
    lineHeight: 25,
  },
  steps: {
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.lg,
  },
  stepRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stepBadge: {
    alignItems: 'center',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  stepBadgeText: {
    color: '#fffdf5',
    fontSize: 16,
    fontWeight: '800',
  },
  stepText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
});
