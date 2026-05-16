import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
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
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LanguagePickerSheet } from '../components/LanguagePickerSheet';
import { defaultTargetLanguage, getLanguageLabel, languageOptions } from '../constants/languages';
import { palette, spacing } from '../constants/theme';
import {
  buildWhatsAppShareUrl,
  fetchYouTubePreview,
  getYouTubeThumbnailUrl,
  parseYouTubeUrl,
  type YouTubePreview,
} from '../lib/youtube';
import {
  formatShareText,
  getFriendlyFailureCopy,
  languagePresets,
} from '../lib/reader';
import type { Doc } from '../../convex/_generated/dataModel';

const { width } = Dimensions.get('window');
const isSmallDevice = width < 375;

const getProcessingCopy = (entry: Doc<'entries'> | null) => {
  if (!entry) {
    return 'We are getting your reader ready.';
  }
  return entry.processingStage ?? 'We are getting your reader ready.';
};

export function HomeScreen({
  backendReady,
  entries,
  isWorking,
  onToggleFavorite,
  onTranscribe,
}: {
  backendReady: boolean;
  entries: Doc<'entries'>[];
  isWorking: boolean;
  onToggleFavorite: (entryId: Doc<'entries'>['_id']) => Promise<void>;
  onTranscribe: (args: {
    channelTitle?: string;
    sourceLanguage: string;
    sourceLanguageLabel: string;
    targetLanguage: string;
    targetLanguageLabel: string;
    thumbnailUrl: string;
    title: string;
    videoId: string;
    youtubeUrl: string;
  }) => Promise<Doc<'entries'>['_id'] | null>;
}) {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  
  const [url, setUrl] = useState('');
  const [view, setView] = useState<'history' | 'input' | 'reading'>('input');
  const [selectedEntryId, setSelectedEntryId] = useState<Doc<'entries'>['_id'] | null>(null);
  const [preview, setPreview] = useState<YouTubePreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState<string>(defaultTargetLanguage.code);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [readerMode, setReaderMode] = useState<'transcript' | 'translation'>('translation');
  const [textSize, setTextSize] = useState(24);
  const [isFocused, setIsFocused] = useState(false);
  const [wasAutoPasted, setWasAutoPasted] = useState(false);

  const deferredUrl = useDeferredValue(url);
  const parsedUrl = parseYouTubeUrl(url);
  const selectedEntry = entries.find((entry) => entry._id === selectedEntryId) ?? entries[0] ?? null;
  const targetLanguageOptions = languageOptions.filter((language) => language.code !== 'auto');

  useEffect(() => {
    if (!selectedEntryId && entries[0]) {
      setSelectedEntryId(entries[0]._id);
    }
  }, [entries, selectedEntryId]);

  useEffect(() => {
    if (!selectedEntry) return;
    if (selectedEntry.translationStatus === 'ready') {
      setReaderMode('translation');
      return;
    }
    setReaderMode('transcript');
  }, [selectedEntry]);

  useEffect(() => {
    const checkClipboard = async () => {
      if (url.trim()) return;
      const content = await Clipboard.getStringAsync();
      const parsed = parseYouTubeUrl(content);
      if (!parsed || wasAutoPasted) return;
      setUrl(parsed.cleanUrl);
      setWasAutoPasted(true);
    };
    void checkClipboard();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void checkClipboard();
    });
    return () => subscription.remove();
  }, [url, wasAutoPasted]);

  useEffect(() => {
    const parsed = parseYouTubeUrl(deferredUrl);
    if (!deferredUrl.trim() || !parsed) {
      setPreview(null);
      setIsPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const nextPreview = await fetchYouTubePreview(parsed.cleanUrl);
        if (!cancelled) setPreview(nextPreview);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [deferredUrl]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = historyQuery.trim().toLowerCase();
    const sorted = [...entries].sort((left, right) => {
      if (left.favorite === right.favorite) return right.updatedAt - left.updatedAt;
      return left.favorite ? -1 : 1;
    });
    if (!normalizedQuery) return sorted;
    return sorted.filter((entry) =>
      [entry.title, entry.channelTitle, entry.targetLanguageLabel]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedQuery)),
    );
  }, [entries, historyQuery]);

  const currentReaderText =
    readerMode === 'translation' && selectedEntry?.translationStatus === 'ready'
      ? selectedEntry.translationText ?? selectedEntry.transcriptText ?? ''
      : selectedEntry?.transcriptText ?? '';

  const currentReaderLabel =
    readerMode === 'translation' && selectedEntry?.translationStatus === 'ready'
      ? `Translation • ${selectedEntry.targetLanguageLabel}`
      : `Transcript • ${selectedEntry?.sourceLanguageLabel ?? 'Original'}`;

  const isReaderReady = selectedEntry?.status === 'ready' && Boolean(selectedEntry.transcriptText);
  const translationReady = selectedEntry?.translationStatus === 'ready';
  const translationFailed = selectedEntry?.translationStatus === 'failed';
  const failureCopy = getFriendlyFailureCopy(selectedEntry?.errorMessage);

  const handleReadVideo = async (entryOverride?: Doc<'entries'> | null) => {
    const nextParsed = entryOverride ? parseYouTubeUrl(entryOverride.youtubeUrl) : parsedUrl;
    if (!nextParsed) {
      Alert.alert('Check the link', 'Please copy the full YouTube video link and paste it here.');
      return;
    }
    if (!backendReady) {
      Alert.alert('Almost ready', 'We are setting up your reader. Please try again in a few seconds.');
      return;
    }

    const nextPreview = entryOverride ? null : preview; // Simplify for history override
    const entryId = await onTranscribe({
      channelTitle: nextPreview?.authorName || entryOverride?.channelTitle,
      sourceLanguage: 'auto',
      sourceLanguageLabel: 'Automatic',
      targetLanguage: entryOverride?.targetLanguage ?? targetLanguage,
      targetLanguageLabel: entryOverride?.targetLanguageLabel ?? getLanguageLabel(targetLanguage),
      thumbnailUrl: nextPreview?.thumbnailUrl ?? (entryOverride?.thumbnailUrl || getYouTubeThumbnailUrl(nextParsed.videoId)),
      title: nextPreview?.title ?? (entryOverride?.title || 'YouTube video'),
      videoId: nextParsed.videoId,
      youtubeUrl: nextParsed.cleanUrl,
    });

    if (entryId) {
      setSelectedEntryId(entryId);
      setView('reading');
    }
  };

  const handleToggleFavorite = async (entryId: Doc<'entries'>['_id']) => {
    await onToggleFavorite(entryId);
  };

  const handleShare = async (content: string, viewLabel: string) => {
    if (!content) {
      Alert.alert('Still working', 'Please wait until the text is ready.');
      return;
    }
    const title = selectedEntry?.title ?? 'YouTube Reader';
    await Linking.openURL(buildWhatsAppShareUrl(formatShareText({ content, title, viewLabel })));
  };

  const handleCopy = async (content: string, label: string) => {
    if (!content) {
      Alert.alert('Still working', `Please wait until the ${label.toLowerCase()} is ready.`);
      return;
    }
    await Clipboard.setStringAsync(content);
    Alert.alert('Copied!', `${label} is ready to paste.`);
  };

  const renderReaderModes = () => {
    if (!selectedEntry) return null;
    return (
      <View style={styles.modeRow}>
        <Pressable
          onPress={() => setReaderMode('translation')}
          style={[
            styles.modeChip,
            {
              backgroundColor: readerMode === 'translation' ? colors.accent : colors.surface,
              borderColor: readerMode === 'translation' ? colors.accent : colors.border,
              opacity: translationReady ? 1 : 0.45,
            },
          ]}
        >
          <Text style={[styles.modeChipText, { color: readerMode === 'translation' ? colors.reader : colors.text }]}>
            Translation
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setReaderMode('transcript')}
          style={[
            styles.modeChip,
            {
              backgroundColor: readerMode === 'transcript' ? colors.accent : colors.surface,
              borderColor: readerMode === 'transcript' ? colors.accent : colors.border,
            },
          ]}
        >
          <Text style={[styles.modeChipText, { color: readerMode === 'transcript' ? colors.reader : colors.text }]}>
            Transcript
          </Text>
        </Pressable>
      </View>
    );
  };

  const renderReadingView = () => {
    if (!selectedEntry) return null;
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: isFocused ? colors.reader : colors.background }]}>
        <View style={[styles.header, { borderBottomWidth: 3, borderColor: colors.border }]}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setView('input');
            }}
            style={styles.backButton}
          >
            <MaterialCommunityIcons name="chevron-left" size={34} color={colors.text} />
            <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
          </Pressable>

          <View style={styles.readerHeaderTools}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setIsFocused(!isFocused);
              }}
              style={[styles.headerIconBtn, { borderColor: colors.border, backgroundColor: isFocused ? colors.accent : colors.surface }]}
            >
              <MaterialCommunityIcons name={isFocused ? 'lamp' : 'lamp-outline'} size={24} color={isFocused ? colors.reader : colors.text} />
            </Pressable>

            <Pressable
              onPress={() => handleToggleFavorite(selectedEntry._id)}
              style={[styles.headerIconBtn, { borderColor: colors.border }]}
            >
              <MaterialCommunityIcons
                color={selectedEntry.favorite ? colors.accent : colors.textSoft}
                name={selectedEntry.favorite ? 'star' : 'star-outline'}
                size={22}
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.readingContainer}>
          <ScrollView contentContainerStyle={styles.readingContent} showsVerticalScrollIndicator={false}>
            {!isFocused && (
              <View style={styles.bookHero}>
                <Text style={[styles.videoTitle, { color: colors.text }]}>{selectedEntry.title}</Text>
                <Text style={[styles.previewAuthor, { color: colors.textSoft }]}>
                  By {selectedEntry.channelTitle ?? 'YouTube'}
                </Text>

                <View style={styles.metaRow}>
                  {renderReaderModes()}
                  <View style={styles.glassesControl}>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setTextSize((current) => Math.max(18, current - 2));
                      }}
                      style={[styles.glassBtn, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.glassBtnText, { color: colors.text }]}>A-</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setTextSize((current) => Math.min(48, current + 2));
                      }}
                      style={[styles.glassBtn, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.glassBtnText, { color: colors.text }]}>A+</Text>
                    </Pressable>
                  </View>
                </View>

                {translationFailed && (
                  <View style={[styles.noticeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <MaterialCommunityIcons color={colors.info} name="information-outline" size={20} />
                    <Text style={[styles.noticeText, { color: colors.text }]}>
                      Showing original transcript (translation failed).
                    </Text>
                  </View>
                )}
              </View>
            )}

            <View
              style={[
                styles.textContainer,
                {
                  backgroundColor: colors.reader,
                  borderColor: isFocused ? 'transparent' : colors.border,
                  borderWidth: isFocused ? 0 : 3,
                  marginTop: isFocused ? spacing.xl : 0,
                },
              ]}
            >
              {!isReaderReady ? (
                <View style={styles.statusWrap}>
                  {selectedEntry.status === 'failed' ? (
                    <>
                      <MaterialCommunityIcons name="alert-circle-outline" size={36} color={colors.danger} />
                      <Text style={[styles.statusTitle, { color: colors.danger }]}>{failureCopy.title}</Text>
                      <Pressable
                        onPress={() => handleReadVideo(selectedEntry)}
                        style={[styles.inlineActionButton, { backgroundColor: colors.accent, borderColor: colors.border, marginTop: 16 }]}
                      >
                        <MaterialCommunityIcons color="#fff" name="refresh" size={18} />
                        <Text style={styles.inlineActionText}>Try Again</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <ActivityIndicator size="large" color={colors.accent} />
                      <Text style={[styles.statusTitle, { color: colors.text }]}>Preparing text...</Text>
                    </>
                  )}
                </View>
              ) : (
                <Text
                  selectable
                  style={[
                    styles.transcriptText,
                    { color: colors.text, fontSize: textSize, lineHeight: textSize * 1.55 },
                  ]}
                >
                  {currentReaderText}
                </Text>
              )}
            </View>

            {!isFocused && (
              <View style={styles.extrasSection}>
                {selectedEntry.summaryText ? (
                  <View style={[styles.extraCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.extraTitle, { color: colors.text }]}>Easy Summary</Text>
                    <Text style={[styles.extraBody, { color: colors.text }]}>{selectedEntry.summaryText}</Text>
                  </View>
                ) : null}

                {selectedEntry.chapters?.length ? (
                  <View style={styles.chaptersBlock}>
                    <Text style={[styles.blockTitle, { color: colors.text }]}>Chapters</Text>
                    {selectedEntry.chapters.map((chapter, index) => (
                      <View
                        key={`${selectedEntry._id}-chapter-${index + 1}`}
                        style={[styles.chapterCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      >
                        <Text style={[styles.chapterTitle, { color: colors.text }]}>
                          {index + 1}. {chapter.title}
                        </Text>
                        <Text style={[styles.chapterSummary, { color: colors.textSoft }]}>
                          {chapter.summary}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.readerBottomPad} />
          </ScrollView>

          <View
            style={[
              styles.stickyToolbelt,
              {
                backgroundColor: isFocused ? colors.reader : colors.background,
                borderTopWidth: 3,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.toolbeltRow}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  handleShare(currentReaderText, currentReaderLabel);
                }}
                style={[styles.toolButton, { backgroundColor: colors.info, borderColor: colors.border }]}
              >
                <MaterialCommunityIcons name="whatsapp" size={26} color="#FFF" />
                <Text style={styles.toolButtonText}>Send to WhatsApp</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                handleCopy(currentReaderText, currentReaderLabel);
              }}
              style={[styles.secondaryToolButton, { borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="content-copy" size={20} color={colors.text} />
              <Text style={[styles.secondaryToolButtonText, { color: colors.text }]}>Copy this text</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  };

  const renderHistoryView = () => (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomWidth: 3, borderColor: colors.border }]}>
        <Pressable onPress={() => setView('input')} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={34} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>History</Text>
      </View>

      <ScrollView contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
        <TextInput
          autoCorrect={false}
          onChangeText={setHistoryQuery}
          placeholder="Search your saved videos..."
          placeholderTextColor={colors.textSoft}
          style={[
            styles.historySearch,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
          value={historyQuery}
        />

        {filteredEntries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="book-open-outline" size={72} color={colors.textSoft} />
            <Text style={[styles.emptyText, { color: colors.textSoft }]}>Nothing matches that search yet.</Text>
          </View>
        ) : (
          filteredEntries.map((entry) => (
            <Pressable
              key={entry._id}
              onPress={() => {
                setSelectedEntryId(entry._id);
                setView('reading');
              }}
              style={[styles.historyItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.historyItemContent}>
                <View style={styles.historyTopRow}>
                  <Text numberOfLines={2} style={[styles.historyItemTitle, { color: colors.text }]}>{entry.title}</Text>
                  <Pressable onPress={() => handleToggleFavorite(entry._id)} style={styles.historyStarButton}>
                    <MaterialCommunityIcons color={entry.favorite ? colors.accent : colors.textSoft} name={entry.favorite ? 'star' : 'star-outline'} size={22} />
                  </Pressable>
                </View>
                <View style={styles.historyBadges}>
                  <View style={[styles.historyBadge, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
                    <Text style={[styles.historyBadgeText, { color: colors.text }]}>{entry.targetLanguageLabel}</Text>
                  </View>
                  <View style={[styles.historyBadge, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
                    <Text style={[styles.historyBadgeText, { color: colors.text }]}>{entry.status}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );

  if (view === 'reading') return renderReadingView();
  if (view === 'history') return renderHistoryView();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.iconContainer, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}>
            <MaterialCommunityIcons name="book-open-page-variant" size={42} color={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>YouTube Reader</Text>
          <Text style={[styles.subtitle, { color: colors.textSoft }]}>
            Paste a YouTube link, choose the language, and we will make an easy reader for you.
          </Text>
        </View>

        <View style={[styles.presetRow, { borderColor: colors.border }]}>
          {languagePresets.map((preset) => {
            const selected = preset.code === targetLanguage;
            return (
              <Pressable
                key={preset.code}
                onPress={() => setTargetLanguage(preset.code)}
                style={[styles.presetButton, { backgroundColor: selected ? colors.accent : colors.surface, borderColor: selected ? colors.accent : colors.border }]}
              >
                <Text style={styles.presetFlag}>{preset.flag}</Text>
                <Text style={[styles.presetLabel, { color: selected ? colors.reader : colors.text }]}>{preset.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.cardHeader, { backgroundColor: colors.border }]}>
            <View style={[styles.stepNumber, { backgroundColor: colors.accent }]}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <Text style={[styles.label, { color: colors.background }]}>Paste Link Below</Text>
          </View>

          <View style={styles.cardBody}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setUrl}
              placeholder="Tap here and paste a YouTube link..."
              placeholderTextColor={colors.textSoft}
              style={[styles.mainInput, { backgroundColor: colors.backgroundAccent, borderColor: colors.border, color: colors.text }]}
              value={url}
            />

            {isPreviewLoading ? (
              <View style={styles.previewPlaceholder}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={[styles.previewPlaceholderText, { color: colors.textSoft }]}>Checking the video...</Text>
              </View>
            ) : preview ? (
              <View style={[styles.previewCard, { borderColor: colors.border, backgroundColor: colors.backgroundAccent }]}>
                <Image source={{ uri: preview.thumbnailUrl }} style={styles.previewThumb} />
                <View style={styles.previewInfo}>
                  <Text numberOfLines={2} style={[styles.previewTitle, { color: colors.text }]}>{preview.title}</Text>
                  <Text style={[styles.previewAuthor, { color: colors.textSoft }]}>{preview.authorName ?? 'YouTube'}</Text>
                </View>
              </View>
            ) : null}

            <Pressable
              onPress={() => setPickerVisible(true)}
              style={[styles.languageCard, { backgroundColor: colors.backgroundAccent, borderColor: colors.border }]}
            >
              <View style={styles.languageCardCopy}>
                <Text style={[styles.languageCardLabel, { color: colors.textSoft }]}>Translate to</Text>
                <Text style={[styles.languageCardValue, { color: colors.text }]}>{getLanguageLabel(targetLanguage)}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={28} color={colors.text} />
            </Pressable>

            <View style={styles.buttonContainer}>
              <Pressable
                disabled={isWorking}
                onPress={() => handleReadVideo(null)}
                style={[styles.bigButton, { backgroundColor: isWorking ? colors.textSoft : colors.accent, borderColor: colors.border }]}
              >
                <View style={styles.buttonContent}>
                  {isWorking ? <ActivityIndicator color="#fff" size="small" /> : null}
                  <Text style={styles.bigButtonText}>{isWorking ? 'Starting Reader...' : '2. Read the Video'}</Text>
                </View>
              </Pressable>
              <View style={[styles.buttonShadow, { backgroundColor: colors.border }]} />
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => setView('history')}
            style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.background }]}
          >
            <MaterialCommunityIcons color={colors.text} name="history" size={24} />
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>View my old videos</Text>
          </Pressable>
        </View>
      </ScrollView>

      <LanguagePickerSheet
        colors={colors}
        onClose={() => setPickerVisible(false)}
        onSelect={(code) => setTargetLanguage(code)}
        options={targetLanguageOptions}
        selectedCode={targetLanguage}
        title="Choose translation language"
        visible={pickerVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  backButton: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  backText: { fontSize: 20, fontWeight: '700' },
  bigButton: { alignItems: 'center', borderRadius: 16, borderWidth: 3, height: 86, justifyContent: 'center', position: 'absolute', width: '100%', zIndex: 1 },
  bigButtonText: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', letterSpacing: 1 },
  blockTitle: { fontSize: 24, fontWeight: '900' },
  bookHero: { gap: spacing.sm, marginBottom: spacing.md },
  bookWrapper: { gap: spacing.md },
  buttonContainer: { height: 100, marginTop: spacing.xs, position: 'relative' },
  buttonContent: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  buttonShadow: { borderRadius: 16, height: 86, position: 'absolute', top: 8, width: '100%' },
  card: { borderRadius: 24, borderWidth: 3, overflow: 'hidden' },
  cardBody: { gap: spacing.md, padding: spacing.lg },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  chapterCard: { borderRadius: 18, borderWidth: 2, gap: spacing.xs, padding: spacing.md },
  chapterSummary: { fontSize: 17, lineHeight: 25 },
  chapterTitle: { fontSize: 19, fontWeight: '800', lineHeight: 26 },
  chaptersBlock: { gap: spacing.sm },
  container: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl, paddingTop: spacing.xl },
  emptyContainer: { alignItems: 'center', gap: spacing.sm, justifyContent: 'center', paddingVertical: 100 },
  emptyText: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  extraBody: { fontSize: 18, lineHeight: 28 },
  extraCard: { borderRadius: 20, borderWidth: 2, gap: spacing.sm, padding: spacing.md },
  extraTitle: { fontSize: 22, fontWeight: '800' },
  extrasSection: { gap: spacing.lg, marginTop: spacing.xl },
  footer: { alignItems: 'center', marginTop: spacing.xl },
  glassBtn: { alignItems: 'center', borderRadius: 999, borderWidth: 2, height: 42, justifyContent: 'center', width: 42 },
  glassBtnText: { fontSize: 16, fontWeight: '800' },
  glassesControl: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  headerIconBtn: { alignItems: 'center', borderRadius: 12, borderWidth: 2, height: 42, justifyContent: 'center', width: 42 },
  headerTitle: { fontSize: 20, fontWeight: '800', textTransform: 'uppercase' },
  hero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  historyBadge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  historyBadgeText: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  historyBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  historyContent: { gap: spacing.md, padding: spacing.md },
  historyItem: { borderRadius: 20, borderWidth: 3, padding: spacing.md },
  historyItemContent: { gap: spacing.sm },
  historyItemTitle: { flex: 1, fontSize: 20, fontWeight: '800', lineHeight: 27 },
  historySearch: { borderRadius: 16, borderWidth: 3, fontSize: 18, minHeight: 62, paddingHorizontal: spacing.md },
  historyStarButton: { paddingLeft: spacing.sm },
  historyTopRow: { alignItems: 'flex-start', flexDirection: 'row' },
  iconContainer: { alignItems: 'center', borderRadius: 24, borderWidth: 3, height: 80, justifyContent: 'center', marginBottom: spacing.xs, transform: [{ rotate: '-4deg' }], width: 80 },
  inlineActionButton: { alignItems: 'center', borderRadius: 14, borderWidth: 2, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md },
  inlineActionText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  label: { fontSize: 22, fontWeight: '800' },
  languageCard: { alignItems: 'center', borderRadius: 16, borderWidth: 3, flexDirection: 'row', justifyContent: 'space-between', minHeight: 76, paddingHorizontal: spacing.md },
  languageCardCopy: { gap: 4 },
  languageCardLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  languageCardValue: { fontSize: 22, fontWeight: '800' },
  mainInput: { borderRadius: 16, borderWidth: 3, fontSize: 20, minHeight: 70, padding: spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  modeChip: { borderRadius: 999, borderWidth: 2, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  modeChipText: { fontSize: 15, fontWeight: '800' },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  noticeCard: { alignItems: 'flex-start', borderRadius: 18, borderWidth: 2, flexDirection: 'row', gap: spacing.sm, padding: spacing.md, marginTop: spacing.sm },
  noticeText: { flex: 1, fontSize: 16, lineHeight: 24 },
  presetButton: { alignItems: 'center', borderRadius: 16, borderWidth: 2, flex: 1, gap: 6, justifyContent: 'center', minHeight: 68, paddingHorizontal: 8 },
  presetFlag: { fontSize: 20 },
  presetLabel: { fontSize: 14, fontWeight: '800' },
  presetRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  previewAuthor: { fontSize: 18, fontWeight: '600' },
  previewCard: { alignItems: 'center', borderRadius: 16, borderWidth: 2, flexDirection: 'row', gap: spacing.sm, overflow: 'hidden', padding: spacing.sm },
  previewInfo: { flex: 1, gap: 2 },
  previewPlaceholder: { alignItems: 'center', gap: 8, height: 100, justifyContent: 'center' },
  previewPlaceholderText: { fontSize: 16, fontWeight: '600' },
  previewThumb: { borderRadius: 8, height: 60, width: 80 },
  previewTitle: { fontSize: 16, fontWeight: '800' },
  readerBottomPad: { height: 220 },
  readerHeaderTools: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  readingContainer: { flex: 1 },
  readingContent: { padding: spacing.md },
  safeArea: { flex: 1 },
  secondaryButton: { alignItems: 'center', borderRadius: 16, borderWidth: 3, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  secondaryButtonText: { fontSize: 18, fontWeight: '700' },
  secondaryToolButton: { alignItems: 'center', borderRadius: 16, borderWidth: 3, flexDirection: 'row', gap: 8, height: 60, justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryToolButtonText: { fontSize: 16, fontWeight: '800' },
  statusTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  statusWrap: { alignItems: 'center', flex: 1, gap: spacing.sm, justifyContent: 'center' },
  stepNumber: { alignItems: 'center', borderRadius: 8, height: 32, justifyContent: 'center', width: 32 },
  stepNumberText: { color: '#FFF', fontSize: 18, fontWeight: '900' },
  stickyToolbelt: { gap: spacing.md, paddingBottom: spacing.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  subtitle: { fontSize: isSmallDevice ? 18 : 22, lineHeight: 30, paddingHorizontal: spacing.md, textAlign: 'center' },
  textContainer: { borderRadius: 20, borderWidth: 3, minHeight: 360, padding: spacing.lg },
  title: { fontSize: isSmallDevice ? 32 : 44, fontWeight: '900', letterSpacing: -1, textAlign: 'center' },
  toolButton: { alignItems: 'center', borderRadius: 16, borderWidth: 3, flex: 1, flexDirection: 'row', gap: 8, height: 74, justifyContent: 'center' },
  toolButtonText: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  toolbeltLabel: { fontSize: 14, fontWeight: '800', letterSpacing: 1.2, textAlign: 'center', textTransform: 'uppercase' },
  toolbeltRow: { flexDirection: 'row', gap: spacing.sm },
  transcriptText: { fontWeight: '500' },
  videoTitle: { fontSize: 32, fontWeight: '900', lineHeight: 40 },
});
