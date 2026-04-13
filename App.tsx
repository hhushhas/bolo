import { useState } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ConvexProvider, ConvexReactClient, useAction, useQuery } from 'convex/react';
import { api } from './convex/_generated/api';
import { HomeScreen } from './src/screens/HomeScreen';
import { parseYouTubeUrl } from './src/lib/youtube';
import { normalizeTranscriptLines } from './src/lib/youtubeCaptions';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

function ConnectedApp() {
  const [isWorking, setIsWorking] = useState(false);
  const entries = useQuery(api.entries.listEntries) ?? [];
  const transcribeVideo = useAction(api.transcribe.transcribeVideo);

  return (
    <HomeScreen
      backendReady
      entries={entries}
      isWorking={isWorking}
      onTranscribe={async (args) => {
        try {
          setIsWorking(true);
          const parsed = parseYouTubeUrl(args.youtubeUrl);
          let transcriptLines = null;

          if (parsed) {
            try {
              const { fetchTranscript } = await import('youtube-transcript/dist/youtube-transcript.esm.js');
              transcriptLines = await fetchTranscript(
                parsed.videoId,
                args.sourceLanguage !== 'auto' ? { lang: args.sourceLanguage } : undefined,
              );
            } catch {
              transcriptLines = null;
            }
          }

          return await transcribeVideo({
            ...args,
            detectedLanguageCode:
              transcriptLines?.find((line) => line.lang)?.lang ?? args.sourceLanguage,
            transcriptText: transcriptLines ? normalizeTranscriptLines(transcriptLines) : undefined,
          });
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
          onTranscribe={async () => null}
        />
      )}
    </>
  );
}
