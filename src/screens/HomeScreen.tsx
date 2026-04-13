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
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { defaultSourceLanguage, defaultTargetLanguage, getLanguageLabel } from '../constants/languages';
import { palette, spacing } from '../constants/theme';
import { buildWhatsAppShareUrl, fetchYouTubePreview, parseYouTubeUrl } from '../lib/youtube';
import { GuideCard } from '../components/GuideCard';
import { LanguagePickerSheet } from '../components/LanguagePickerSheet';
import { ResultReader } from '../components/ResultReader';
import { HistoryList } from '../components/HistoryList';
import type { Doc } from '../../convex/_generated/dataModel';

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
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof fetchYouTubePreview>> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<Doc<'entries'>['_id'] | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState<string>(defaultSourceLanguage.code);
  const [targetLanguage, setTargetLanguage] = useState<string>(defaultTargetLanguage.code);
  const [activeView, setActiveView] = useState<'transcript' | 'translation'>('translation');
  const [picker, setPicker] = useState<'source' | 'target' | null>(null);
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
      setPreviewError('Paste a full YouTube video or Shorts link to continue.');
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
          setPreviewError(error instanceof Error ? error.message : 'We could not load that video preview.');
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [deferredUrl]);

  const selectedEntry = entries.find((entry) => entry._id === selectedEntryId) ?? null;

  const shareText =
    selectedEntry &&
    [
      selectedEntry.title,
      `${selectedEntry.sourceLanguageLabel} to ${selectedEntry.targetLanguageLabel}`,
      '',
      activeView === 'translation' ? selectedEntry.translationText : selectedEntry.transcriptText,
    ]
      .filter(Boolean)
      .join('\n');

  const handleTranscribe = async () => {
    const parsed = parseYouTubeUrl(url);

    if (!parsed) {
      Alert.alert('Link needed', 'Please paste a YouTube video or Shorts link first.');
      return;
    }

    if (!backendReady) {
      Alert.alert(
        'Backend setup needed',
        'Add your Convex URL and OpenRouter key to enable transcription and translation.',
      );
      return;
    }

    const entryId = await onTranscribe({
      sourceLanguage,
      sourceLanguageLabel: getLanguageLabel(sourceLanguage),
      targetLanguage,
      targetLanguageLabel: getLanguageLabel(targetLanguage),
      youtubeUrl: parsed.cleanUrl,
    });

    if (entryId) {
      setSelectedEntryId(entryId);
      setActiveView(targetLanguage === sourceLanguage ? 'transcript' : 'translation');
    }
  };

  const handleCopy = async () => {
    if (!shareText) {
      return;
    }

    await Clipboard.setStringAsync(shareText);
    Alert.alert('Copied', 'The current text is ready to paste anywhere.');
  };

  const handleShare = async () => {
    if (!shareText) {
      return;
    }

    await Linking.openURL(buildWhatsAppShareUrl(shareText));
  };

  const handleSelectEntry = (entryId: Doc<'entries'>['_id']) => {
    const entry = entries.find((item) => item._id === entryId);

    if (!entry) {
      return;
    }

    startTransition(() => {
      setSelectedEntryId(entryId);
      setUrl(entry.youtubeUrl);
      setPreview({
        authorName: entry.channelTitle,
        kind: 'video',
        thumbnailUrl: entry.thumbnailUrl,
        title: entry.title,
        url: entry.youtubeUrl,
        videoId: entry.videoId,
      });
      setSourceLanguage(entry.sourceLanguage);
      setTargetLanguage(entry.targetLanguage);
      setActiveView(entry.translationText ? 'translation' : 'transcript');
    });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <GuideCard colors={colors} />

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>1. Paste your YouTube link</Text>
          <Text style={[styles.sectionCopy, { color: colors.textSoft }]}>
            Shorts and normal YouTube videos are both supported.
          </Text>

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUrl}
            placeholder="https://www.youtube.com/watch?v=..."
            placeholderTextColor={colors.textSoft}
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundAccent,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={url}
          />

          <View style={styles.languageRow}>
            <Pressable
              onPress={() => setPicker('source')}
              style={[styles.languageButton, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}
            >
              <Text style={[styles.languageLabel, { color: colors.textSoft }]}>From</Text>
              <Text style={[styles.languageValue, { color: colors.text }]}>{getLanguageLabel(sourceLanguage)}</Text>
            </Pressable>

            <Pressable
              onPress={() => setPicker('target')}
              style={[styles.languageButton, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}
            >
              <Text style={[styles.languageLabel, { color: colors.textSoft }]}>To</Text>
              <Text style={[styles.languageValue, { color: colors.text }]}>{getLanguageLabel(targetLanguage)}</Text>
            </Pressable>
          </View>

          {preview ? (
            <View style={[styles.previewCard, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
              <Image source={{ uri: preview.thumbnailUrl }} style={styles.thumbnail} />
              <View style={styles.previewText}>
                <Text style={[styles.previewTag, { color: colors.accent }]}>
                  {preview.kind === 'short' ? 'Shorts preview' : 'Video preview'}
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
            <View style={[styles.helperCard, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
              <Text style={[styles.helperText, { color: colors.textSoft }]}>
                {previewError ?? 'We will show the thumbnail and title here as soon as the link looks valid.'}
              </Text>
            </View>
          )}

          {!backendReady ? (
            <View style={[styles.setupCard, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
              <MaterialCommunityIcons color={colors.info} name="server-outline" size={24} />
              <View style={styles.setupCopy}>
                <Text style={[styles.setupTitle, { color: colors.text }]}>Backend not connected yet</Text>
                <Text style={[styles.setupText, { color: colors.textSoft }]}>
                  Add `EXPO_PUBLIC_CONVEX_URL` for the app and set `OPENROUTER_API_KEY` in Convex to enable the live flow.
                </Text>
              </View>
            </View>
          ) : null}

          <Pressable
            onPress={handleTranscribe}
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isWorking ? 'Working on your video...' : '2. Transcribe this video'}
            </Text>
          </Pressable>
        </View>

        <ResultReader
          activeView={activeView}
          colors={colors}
          entry={selectedEntry}
          onChangeView={setActiveView}
          onCopy={handleCopy}
          onShare={handleShare}
        />

        <HistoryList
          colors={colors}
          entries={entries}
          onSelect={handleSelectEntry}
          selectedEntryId={selectedEntryId}
        />
      </ScrollView>

      <LanguagePickerSheet
        colors={colors}
        onClose={() => setPicker(null)}
        onSelect={picker === 'source' ? setSourceLanguage : setTargetLanguage}
        selectedCode={picker === 'source' ? sourceLanguage : targetLanguage}
        title={picker === 'source' ? 'Choose transcript language' : 'Choose translation language'}
        visible={picker !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.md,
    paddingBottom: 64,
  },
  helperCard: {
    borderRadius: 22,
    borderWidth: 1,
    minHeight: 96,
    justifyContent: 'center',
    padding: spacing.md,
  },
  helperText: {
    fontSize: 16,
    lineHeight: 24,
  },
  input: {
    borderRadius: 20,
    borderWidth: 1,
    fontSize: 18,
    lineHeight: 26,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  languageButton: {
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    minHeight: 74,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  languageLabel: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  languageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  languageValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  previewCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: spacing.md,
    overflow: 'hidden',
  },
  previewMeta: {
    fontSize: 15,
    lineHeight: 22,
  },
  previewTag: {
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  previewText: {
    gap: 6,
    padding: spacing.md,
  },
  previewTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 27,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  primaryButtonLabel: {
    color: '#fff9e8',
    fontSize: 18,
    fontWeight: '800',
  },
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  sectionCopy: {
    fontSize: 16,
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  setupCard: {
    alignItems: 'flex-start',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  setupCopy: {
    flex: 1,
    gap: 4,
  },
  setupText: {
    fontSize: 15,
    lineHeight: 22,
  },
  setupTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  thumbnail: {
    aspectRatio: 16 / 9,
    width: '100%',
  },
});
