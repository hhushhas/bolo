import { useState, useEffect, useDeferredValue } from 'react';
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
  ActivityIndicator,
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
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const deferredUrl = useDeferredValue(url);

  // Handle YouTube Preview Fetching
  useEffect(() => {
    const parsed = parseYouTubeUrl(deferredUrl);
    if (!deferredUrl.trim() || !parsed) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const nextPreview = await fetchYouTubePreview(parsed.cleanUrl);
        if (!cancelled) {
          setPreview(nextPreview);
        }
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [deferredUrl]);

  const selectedEntry = entries.find((e) => e._id === selectedEntryId) || entries[0];

  const handleReadVideo = async () => {
    const parsed = parseYouTubeUrl(url);
    if (!parsed) {
      Alert.alert('Check the Link', 'Please copy the link from YouTube and paste it in the box.');
      return;
    }

    if (!backendReady) {
      Alert.alert('Almost Ready', 'We are setting up your reader. Please try again in a few seconds.');
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
      Alert.alert('Sorry!', 'We couldn\'t read this video. Please try another one.');
    }
  };

  const handleSelectHistory = (id: Doc<'entries'>['_id']) => {
    setSelectedEntryId(id);
    setView('reading');
  };

  // --- SUB-VIEWS ---

  const renderReadingView = () => {
    if (!selectedEntry) return null;

    const selectedText = selectedEntry.translationText || selectedEntry.transcriptText || '';
    const isReady = selectedEntry.status === 'ready' && Boolean(selectedText);
    const isFailed = selectedEntry.status === 'failed';

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomWidth: 3, borderColor: colors.border }]}>
          <Pressable onPress={() => setView('input')} style={styles.backButton}>
            <MaterialCommunityIcons name="chevron-left" size={38} color={colors.text} />
            <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Reading Mode</Text>
        </View>
        
        <ScrollView contentContainerStyle={styles.readingContent} showsVerticalScrollIndicator={false}>
          <View style={styles.bookWrapper}>
            <View style={[styles.readingPreviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Image source={{ uri: selectedEntry.thumbnailUrl }} style={styles.readingPreviewThumb} />
              <View style={styles.readingPreviewInfo}>
                <Text style={[styles.previewBadge, { color: colors.accent }]}>
                  {isFailed ? 'Could not transcribe' : isReady ? 'Ready to read' : 'Preparing transcript'}
                </Text>
                <Text numberOfLines={3} style={[styles.readingPreviewTitle, { color: colors.text }]}>
                  {selectedEntry.title}
                </Text>
                <Text style={[styles.previewAuthor, { color: colors.textSoft }]}>
                  {selectedEntry.channelTitle ?? 'YouTube'}
                </Text>
              </View>
            </View>

            <Text style={[styles.videoTitle, { color: colors.text }]}>{selectedEntry.title}</Text>
            <View style={[styles.textContainer, { backgroundColor: colors.reader, borderColor: colors.border }]}>
              {isFailed ? (
                <View style={styles.statusWrap}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={36} color={colors.danger} />
                  <Text style={[styles.statusTitle, { color: colors.danger }]}>We could not get the transcript</Text>
                  <Text style={[styles.statusText, { color: colors.text }]}>
                    {selectedEntry.errorMessage ?? 'Please try another video.'}
                  </Text>
                </View>
              ) : isReady ? (
                <Text selectable style={[styles.transcriptText, { color: colors.text }]}>
                  {selectedText}
                </Text>
              ) : (
                <View style={styles.statusWrap}>
                  <ActivityIndicator size="large" color={colors.accent} />
                  <Text style={[styles.statusTitle, { color: colors.text }]}>Preparing your transcript</Text>
                  <Text style={[styles.statusText, { color: colors.textSoft }]}>
                    Stay on this screen for a few seconds. The text will appear here as soon as it is ready.
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.toolbelt}>
            <Text style={[styles.toolbeltLabel, { color: colors.textSoft }]}>SHARE OR SAVE THIS TEXT</Text>
            <View style={styles.toolbeltRow}>
              <Pressable 
                onPress={() => {
                  if (!isReady) {
                    Alert.alert('Not ready yet', 'Please wait until the transcript appears before sharing.');
                    return;
                  }

                  Linking.openURL(buildWhatsAppShareUrl(`Check out this video: ${selectedEntry.title}\n\n${selectedText}`));
                }}
                style={({ pressed }) => [
                  styles.toolButton, 
                  { backgroundColor: colors.info, borderColor: colors.border, top: pressed ? 4 : 0 }
                ]}
              >
                <MaterialCommunityIcons name="whatsapp" size={32} color="#FFF" />
                <Text style={styles.toolButtonText}>WhatsApp</Text>
                <View style={[styles.toolShadow, { backgroundColor: colors.border }]} />
              </Pressable>
              
              <Pressable 
                onPress={async () => {
                  if (!isReady) {
                    Alert.alert('Not ready yet', 'Please wait until the transcript appears before copying.');
                    return;
                  }

                  await Clipboard.setStringAsync(selectedText);
                  Alert.alert('Copied!', 'The text is ready to paste anywhere.');
                }}
                style={({ pressed }) => [
                  styles.toolButton, 
                  { backgroundColor: colors.accent, borderColor: colors.border, top: pressed ? 4 : 0 }
                ]}
              >
                <MaterialCommunityIcons name="content-copy" size={32} color="#FFF" />
                <Text style={styles.toolButtonText}>Copy Text</Text>
                <View style={[styles.toolShadow, { backgroundColor: colors.border }]} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  };

  const renderHistoryView = () => (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomWidth: 3, borderColor: colors.border }]}>
        <Pressable onPress={() => setView('input')} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={38} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My History</Text>
      </View>
      <ScrollView contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
        {entries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="book-open-outline" size={80} color={colors.textSoft} />
            <Text style={[styles.emptyText, { color: colors.textSoft }]}>Your library is empty.</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSoft }]}>Videos you read will appear here.</Text>
          </View>
        ) : (
          entries.map((entry) => (
            <Pressable 
              key={entry._id} 
              onPress={() => handleSelectHistory(entry._id)}
              style={({ pressed }) => [
                styles.historyItem, 
                { 
                  backgroundColor: pressed ? colors.backgroundAccent : colors.surface, 
                  borderColor: colors.border 
                }
              ]}
            >
              <View style={styles.historyItemContent}>
                <Text numberOfLines={2} style={[styles.historyItemTitle, { color: colors.text }]}>{entry.title}</Text>
                <Text style={[styles.historyItemDate, { color: colors.textSoft }]}>
                  {entry.sourceLanguageLabel} to {entry.targetLanguageLabel}
                </Text>
              </View>
              <MaterialCommunityIcons name="arrow-right-circle" size={32} color={colors.accent} />
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
            We will turn any video into a large-print book for you to read easily.
          </Text>
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
              style={[styles.mainInput, { 
                backgroundColor: colors.backgroundAccent, 
                borderColor: colors.border,
                color: colors.text 
              }]}
              placeholder="Tap here and paste link..."
              placeholderTextColor={colors.textSoft}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* Video Preview Logic */}
            {isPreviewLoading ? (
              <View style={styles.previewPlaceholder}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={[styles.previewPlaceholderText, { color: colors.textSoft }]}>Checking video...</Text>
              </View>
            ) : preview ? (
              <View style={[styles.previewCard, { borderColor: colors.border, backgroundColor: colors.backgroundAccent }]}>
                <Image source={{ uri: preview.thumbnailUrl }} style={styles.previewThumb} />
                <View style={styles.previewInfo}>
                  <Text numberOfLines={2} style={[styles.previewTitle, { color: colors.text }]}>{preview.title}</Text>
                  <Text style={[styles.previewAuthor, { color: colors.textSoft }]}>{preview.authorName}</Text>
                </View>
              </View>
            ) : null}

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
                <View style={styles.buttonContent}>
                  {isWorking && <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 8 }} />}
                  <Text style={styles.bigButtonText}>
                    {isWorking ? 'Reading Video...' : '2. Read the Video'}
                  </Text>
                </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 20,
    fontWeight: '700',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
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
  previewPlaceholder: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  previewPlaceholderText: {
    fontSize: 16,
    fontWeight: '600',
  },
  previewCard: {
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  previewThumb: {
    width: 80,
    height: 60,
    borderRadius: 8,
  },
  previewInfo: {
    flex: 1,
    gap: 2,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  previewAuthor: {
    fontSize: 14,
    fontWeight: '600',
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
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
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
  readingContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  bookWrapper: {
    gap: spacing.md,
  },
  readingPreviewCard: {
    borderRadius: 18,
    borderWidth: 3,
    overflow: 'hidden',
  },
  readingPreviewThumb: {
    aspectRatio: 16 / 9,
    width: '100%',
  },
  readingPreviewInfo: {
    gap: 4,
    padding: spacing.md,
  },
  previewBadge: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  readingPreviewTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
  },
  videoTitle: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 36,
  },
  textContainer: {
    padding: spacing.lg,
    borderRadius: 20,
    borderWidth: 3,
    minHeight: 400,
  },
  statusWrap: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  statusTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  statusText: {
    fontSize: 20,
    lineHeight: 30,
    textAlign: 'center',
  },
  transcriptText: {
    fontSize: 24,
    lineHeight: 38,
    fontWeight: '500',
  },
  toolbelt: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  toolbeltLabel: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  toolbeltRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  toolButton: {
    flex: 1,
    height: 80,
    borderRadius: 16,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  toolButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '900',
  },
  toolShadow: {
    position: 'absolute',
    width: '100%',
    height: 80,
    borderRadius: 16,
    top: 6,
    zIndex: -1,
  },
  historyContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  historyItem: {
    padding: spacing.md,
    borderRadius: 20,
    borderWidth: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyItemContent: {
    flex: 1,
    gap: 4,
  },
  historyItemTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  historyItemDate: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 24,
    fontWeight: '800',
  },
  emptySubtext: {
    fontSize: 18,
    textAlign: 'center',
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
    fontWeight: '700',
  },
});
