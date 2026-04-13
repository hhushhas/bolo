import { useState } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ConvexProvider, ConvexReactClient, useAction, useMutation, useQuery } from 'convex/react';
import { api } from './convex/_generated/api';
import { HomeScreen } from './src/screens/HomeScreen';
import { parseYouTubeUrl } from './src/lib/youtube';
import { normalizeTranscriptLines } from './src/lib/youtubeCaptions';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

function ConnectedApp() {
  const [isWorking, setIsWorking] = useState(false);
  const entries = useQuery(api.entries.listEntries) ?? [];
  const queueEntry = useMutation(api.entries.queueEntry);
  const toggleFavorite = useMutation(api.entries.toggleFavorite);
  const processEntry = useAction(api.transcribe.processEntry);

  return (
    <HomeScreen
      backendReady
      entries={entries}
      isWorking={isWorking}
      onToggleFavorite={async (entryId) => {
        await toggleFavorite({ entryId });
      }}
      onTranscribe={async (args) => {
        try {
          setIsWorking(true);
          const parsed = parseYouTubeUrl(args.youtubeUrl);

          if (!parsed) {
            return null;
          }

          const entryId = await queueEntry({
            channelTitle: args.channelTitle,
            createdAt: Date.now(),
            processingStage: 'Starting up your reader',
            sourceLanguage: args.sourceLanguage,
            sourceLanguageLabel: args.sourceLanguageLabel,
            targetLanguage: args.targetLanguage,
            targetLanguageLabel: args.targetLanguageLabel,
            thumbnailUrl: args.thumbnailUrl,
            title: args.title,
            updatedAt: Date.now(),
            videoId: args.videoId,
            youtubeUrl: parsed.cleanUrl,
          });

          let transcriptLines = null;

          try {
            const { fetchTranscript } = await import('youtube-transcript/dist/youtube-transcript.esm.js');
            transcriptLines = await fetchTranscript(
              parsed.videoId,
              args.sourceLanguage !== 'auto' ? { lang: args.sourceLanguage } : undefined,
            );
          } catch {
            transcriptLines = null;
          }

          void processEntry({
            ...args,
            entryId,
            detectedLanguageCode:
              transcriptLines?.find((line) => line.lang)?.lang ?? args.sourceLanguage,
            transcriptText: transcriptLines ? normalizeTranscriptLines(transcriptLines) : undefined,
            youtubeUrl: parsed.cleanUrl,
          }).catch((error) => {
            Alert.alert(
              'We hit a small problem',
              error instanceof Error ? error.message : 'Please try this video again.',
            );
          });

          return entryId;
        } catch (error) {
          Alert.alert(
            'Something went wrong',
            error instanceof Error ? error.message : 'Please try again in a moment.',
          );
          return null;
        } finally {
          setIsWorking(false);
        }
      }}
    />
  );
}

export default function App() {
  return (
    <>
      <StatusBar style="auto" />
      {convexClient ? (
        <ConvexProvider client={convexClient}>
          <ConnectedApp />
        </ConvexProvider>
      ) : (
        <HomeScreen
          backendReady={false}
          entries={[]}
          isWorking={false}
          onToggleFavorite={async () => undefined}
          onTranscribe={async () => null}
        />
      )}
    </>
  );
}
