import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { palette, spacing } from '../constants/theme';
import {
  buildWhatsAppShareUrl,
  fetchYouTubePreview,
  parseYouTubeUrl,
  type YouTubePreview,
} from '../lib/youtube';
import type { Doc } from '../../convex/_generated/dataModel';

const { width } = Dimensions.get('window');
const isSmallDevice = width < 375;

export function HomeScreen({
  backendReady,
  entries,
  isWorking,
  onTranscribe,
}: {
  backendReady: boolean;
  entries: Doc<'entries'>[];
  isWorking: boolean;
  onTranscribe: (args: {
    sourceLanguage: string;
    sourceLanguageLabel: string;
    targetLanguage: string;
    targetLanguageLabel: string;
    youtubeUrl: string;
  }) => Promise<Doc<'entries'>['_id'] | null>;
}) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];

  const [url, setUrl] = useState('');
  const [view, setView] = useState<'input' | 'reading' | 'history'>('input');
  const [selectedEntryId, setSelectedEntryId] = useState<Doc<'entries'>['_id'] | null>(null);
  const [preview, setPreview] = useState<YouTubePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const deferredUrl = useDeferredValue(url);

  useEffect(() => {
    if (!selectedEntryId && entries[0]) {
      setSelectedEntryId(entries[0]._id);
    }
  }, [entries, selectedEntryId]);

  useEffect(() => {
    const parsed = parseYouTubeUrl(deferredUrl);

    if (!deferredUrl.trim()) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    if (!parsed) {
      setPreview(null);
      setPreviewError('Paste a full YouTube video or Shorts link to see the preview.');
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const nextPreview = await fetchYouTubePreview(parsed.cleanUrl);

        if (!cancelled) {
          startTransition(() => {
            setPreview(nextPreview);
            setPreviewError(null);
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(
            error instanceof Error ? error.message : 'We could not load that video preview.',
          );
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [deferredUrl]);

  const selectedEntry = entries.find((entry) => entry._id === selectedEntryId) ?? entries[0] ?? null;
  const selectedText = selectedEntry?.translationText || selectedEntry?.transcriptText || '';
  const readingStatusLabel =
    selectedEntry?.status === 'failed'
      ? 'Needs another try'
      : selectedEntry?.status === 'ready'
        ? 'Ready to read'
        : 'Working on it';

  const handleReadVideo = async () => {
    const parsed = parseYouTubeUrl(url);
    if (!parsed) {
      Alert.alert('Please check the link', 'Copy the full link from YouTube and paste it here.');
      return;
    }

    if (!backendReady) {
      Alert.alert('App Maintenance', 'We are getting things ready. Please try again later.');
      return;
    }

    try {
      const entryId = await onTranscribe({
        sourceLanguage: 'auto',
        sourceLanguageLabel: 'Automatic',
        targetLanguage: 'en',
        targetLanguageLabel: 'English',
        youtubeUrl: parsed.cleanUrl,
      });

      if (entryId) {
        setSelectedEntryId(entryId);
        setView('reading');
      }
    } catch {
      Alert.alert('Error', 'Could not read that video. Please try another one.');
    }
  };

  const handleSelectHistory = (id: Doc<'entries'>['_id']) => {
    const entry = entries.find((item) => item._id === id);

    if (!entry) {
      return;
    }

    startTransition(() => {
      setSelectedEntryId(id);
      setUrl(entry.youtubeUrl);
      setPreview({
        authorName: entry.channelTitle,
        kind: 'video',
        thumbnailUrl: entry.thumbnailUrl,
        title: entry.title,
        url: entry.youtubeUrl,
        videoId: entry.videoId,
      });
      setPreviewError(null);
      setView('reading');
    });
  };

  const handleShareWhatsApp = async () => {
    if (!selectedEntry || selectedEntry.status !== 'ready' || !selectedText) {
      Alert.alert('Almost ready', 'Please wait until the transcript appears before sharing.');
      return;
    }

    const text = `Check out this video summary: ${selectedEntry.title}\n\n${selectedText}`;
    await Linking.openURL(buildWhatsAppShareUrl(text));
  };

  if (view === 'reading' && selectedEntry) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Pressable onPress={() => setView('input')} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={32} color={colors.text} />
            <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
          </Pressable>
        </View>
        
        <ScrollView contentContainerStyle={styles.readingContent} showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.readingPreviewCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <Image source={{ uri: selectedEntry.thumbnailUrl }} style={styles.readingThumbnail} />
            <View style={styles.readingPreviewBody}>
              <View
                style={[
                  styles.readingBadge,
                  { backgroundColor: colors.backgroundAccent, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.readingBadgeText, { color: colors.accent }]}>
                  {readingStatusLabel}
                </Text>
              </View>
              <Text style={[styles.videoTitle, { color: colors.text }]}>{selectedEntry.title}</Text>
              <Text style={[styles.videoMeta, { color: colors.textSoft }]}>
                {selectedEntry.channelTitle ?? 'YouTube'} • {selectedEntry.targetLanguageLabel}
              </Text>
            </View>
          </View>

          {selectedEntry.status === 'failed' ? (
            <View
              style={[
                styles.readerCard,
                { backgroundColor: colors.surface, borderColor: colors.danger, shadowColor: colors.shadow },
              ]}
            >
              <Text style={[styles.readerHeading, { color: colors.danger }]}>This video could not be read</Text>
              <Text style={[styles.transcriptText, { color: colors.text }]}>
                {selectedEntry.errorMessage ?? 'Please try another YouTube video link.'}
              </Text>
            </View>
          ) : selectedEntry.status !== 'ready' ? (
            <View
              style={[
                styles.readerCard,
                { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.shadow },
              ]}
            >
              <Text style={[styles.readerHeading, { color: colors.text }]}>We are preparing the text</Text>
              <Text style={[styles.readerSupport, { color: colors.textSoft }]}>
                Stay on this screen for a moment. When the transcript is ready, it will appear right here.
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.readerCard,
                {
                  backgroundColor: colors.reader,
                  borderColor: colors.border,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <Text style={[styles.readerHeading, { color: colors.text }]}>Translation</Text>
              <Text selectable style={[styles.transcriptText, { color: colors.text }]}>
                {selectedText}
              </Text>
            </View>
          )}

          <View style={styles.actionRow}>
            <Pressable
              onPress={handleShareWhatsApp}
              style={[
                styles.actionButton,
                {
                  backgroundColor: selectedEntry.status === 'ready' ? colors.info : colors.textSoft,
                },
              ]}
            >
              <MaterialCommunityIcons name="whatsapp" size={28} color="#FFF" />
              <Text style={styles.actionButtonText}>Send to WhatsApp</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                if (selectedEntry.status !== 'ready' || !selectedText) {
                  Alert.alert('Almost ready', 'Please wait until the transcript appears before copying.');
                  return;
                }

                await Clipboard.setStringAsync(selectedText);
                Alert.alert('Copied!', 'The text is ready to paste.');
              }}
              style={[
                styles.actionButton,
                {
                  backgroundColor: selectedEntry.status === 'ready' ? colors.accent : colors.textSoft,
                },
              ]}
            >
              <MaterialCommunityIcons name="content-copy" size={28} color="#FFF" />
              <Text style={styles.actionButtonText}>Copy Text</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (view === 'history') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Pressable onPress={() => setView('input')} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={32} color={colors.text} />
            <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.historyContent}>
          <Text style={[styles.screenTitle, { color: colors.text }]}>Your Old Videos</Text>
          {entries.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSoft }]}>You have not read any videos yet.</Text>
          ) : (
            entries.map((entry) => (
              <Pressable 
                key={entry._id} 
                onPress={() => handleSelectHistory(entry._id)}
                style={[styles.historyItem, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}
              >
                <Text numberOfLines={2} style={[styles.historyItemTitle, { color: colors.text }]}>{entry.title}</Text>
                <MaterialCommunityIcons name="chevron-right" size={32} color={colors.textSoft} />
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.iconContainer, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
            <MaterialCommunityIcons name="book-open-page-variant" size={42} color={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>YouTube Reader</Text>
          <Text style={[styles.subtitle, { color: colors.textSoft }]}>
            We will turn any video into a large-print book for you to read easily.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.shadow }]}>
          <View style={[styles.cardHeader, { backgroundColor: colors.border }]}>
            <View style={[styles.stepNumber, { backgroundColor: colors.accent }]}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <Text style={[styles.label, { color: colors.background }]}>Paste Link Below</Text>
          </View>
          
          <View style={styles.cardBody}>
            <TextInput
              style={[styles.mainInput, {
                backgroundColor: colors.backgroundAccent,
                borderColor: colors.border,
                color: colors.text,
              }]}
              placeholder="Tap here and paste link..."
              placeholderTextColor={colors.textSoft}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {preview ? (
              <View
                style={[
                  styles.previewCard,
                  {
                    backgroundColor: colors.backgroundAccent,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Image source={{ uri: preview.thumbnailUrl }} style={styles.previewThumbnail} />
                <View style={styles.previewBody}>
                  <Text style={[styles.previewEyebrow, { color: colors.accent }]}>
                    {preview.kind === 'short' ? 'YouTube Shorts' : 'YouTube video'}
                  </Text>
                  <Text numberOfLines={3} style={[styles.previewTitle, { color: colors.text }]}>
                    {preview.title}
                  </Text>
                  <Text style={[styles.previewMeta, { color: colors.textSoft }]}>
                    {preview.authorName ?? 'YouTube'}
                  </Text>
                </View>
              </View>
            ) : (
              <View
                style={[
                  styles.previewHelp,
                  {
                    backgroundColor: colors.backgroundAccent,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.previewHelpText, { color: colors.textSoft }]}>
                  {previewError ?? 'The thumbnail and title will appear here after you paste a valid link.'}
                </Text>
              </View>
            )}

            <View style={styles.buttonContainer}>
              <Pressable
                onPress={handleReadVideo}
                disabled={isWorking}
                style={({ pressed }) => [
                  styles.bigButton,
                  {
                    backgroundColor: isWorking ? colors.textSoft : colors.accent,
                    borderColor: colors.border,
                    opacity: pressed ? 0.9 : 1,
                    top: pressed ? 4 : 0,
                  }
                ]}
              >
                <Text style={styles.bigButtonText}>
                  {isWorking ? 'Thinking...' : '2. Read the Video'}
                </Text>
              </Pressable>
              <View style={[styles.buttonShadow, { backgroundColor: colors.border }]} />
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Pressable 
            onPress={() => setView('history')}
            style={({ pressed }) => [
              styles.secondaryButton, 
              { 
                borderColor: colors.border,
                backgroundColor: pressed ? colors.backgroundAccent : colors.background
              }
            ]}
          >
            <MaterialCommunityIcons name="history" size={24} color={colors.text} />
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>View my old videos</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    padding: spacing.md,
    flexGrow: 1,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  hero: {
    marginBottom: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
    transform: [{ rotate: '-4deg' }],
  },
  title: {
    fontSize: isSmallDevice ? 32 : 44,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: isSmallDevice ? 18 : 22,
    textAlign: 'center',
    lineHeight: 30,
    paddingHorizontal: spacing.md,
  },
  card: {
    borderRadius: 24,
    borderWidth: 3,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardBody: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '900',
  },
  label: {
    fontSize: 22,
    fontWeight: '800',
  },
  mainInput: {
    borderWidth: 3,
    borderRadius: 16,
    padding: spacing.md,
    fontSize: 20,
    minHeight: 70,
  },
  buttonContainer: {
    marginTop: spacing.xs,
    position: 'relative',
    height: 100,
  },
  bigButton: {
    height: 86,
    borderRadius: 16,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    position: 'absolute',
    width: '100%',
  },
  buttonShadow: {
    height: 86,
    borderRadius: 16,
    position: 'absolute',
    width: '100%',
    top: 8,
  },
  bigButtonText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1,
  },
  footer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderWidth: 3,
    borderRadius: 16,
    gap: spacing.sm,
  },
  secondaryButtonText: {
    fontSize: 18,
    fontWeight: '600',
  },
  header: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backText: {
    fontSize: 22,
    fontWeight: '700',
  },
  readingContent: {
    padding: spacing.md,
    paddingBottom: 100,
  },
  readingPreviewCard: {
    borderRadius: 24,
    borderWidth: 3,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  readingThumbnail: {
    aspectRatio: 16 / 9,
    width: '100%',
  },
  readingPreviewBody: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  readingBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  readingBadgeText: {
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  videoTitle: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 38,
    marginBottom: spacing.sm,
  },
  videoMeta: {
    fontSize: 18,
    lineHeight: 26,
  },
  divider: {
    height: 2,
    marginBottom: spacing.md,
  },
  readerCard: {
    borderRadius: 24,
    borderWidth: 3,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  readerHeading: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  readerSupport: {
    fontSize: 20,
    lineHeight: 32,
  },
  transcriptText: {
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '500',
  },
  actionRow: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  actionButton: {
    height: 80,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
  },
  previewCard: {
    borderRadius: 18,
    borderWidth: 3,
    overflow: 'hidden',
  },
  previewThumbnail: {
    aspectRatio: 16 / 9,
    width: '100%',
  },
  previewBody: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  previewEyebrow: {
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  previewTitle: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 30,
  },
  previewMeta: {
    fontSize: 18,
    lineHeight: 24,
  },
  previewHelp: {
    borderRadius: 18,
    borderWidth: 3,
    padding: spacing.md,
  },
  previewHelpText: {
    fontSize: 18,
    lineHeight: 28,
  },
  historyContent: {
    padding: spacing.md,
  },
  screenTitle: {
    fontSize: 32,
    fontWeight: '900',
    marginBottom: spacing.lg,
  },
  historyItem: {
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  historyItemTitle: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
    marginRight: spacing.sm,
  },
  emptyText: {
    fontSize: 20,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
