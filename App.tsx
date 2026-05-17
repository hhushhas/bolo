import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from 'convex/react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from './convex/_generated/api';
import { HomeScreen } from './src/screens/HomeScreen';
import { parseYouTubeUrl } from './src/lib/youtube';
import {
  splitDisplaySegmentsForCaptions,
  type DisplayTranscriptSegment,
  type ProcessingDebugReport,
} from './src/lib/syncedTranscript';
import type { Id } from './convex/_generated/dataModel';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;
const emptySyncedSegments: DisplayTranscriptSegment[] = [];

function ConnectedApp() {
  const [isWorking, setIsWorking] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<Id<'entries'> | null>(null);
  const migrationStartedRef = useRef(false);
  const entries = useQuery(api.entries.listEntries) ?? [];
  const selectedEntry = entries.find((entry) => entry._id === selectedEntryId) ?? entries[0] ?? null;
  const selectedEntryIsSynced = selectedEntry?.processingVersion === 2;
  const queriedSyncedSegments = useQuery(
    api.entries.listEntrySegments,
    selectedEntryId && selectedEntryIsSynced ? { entryId: selectedEntryId } : 'skip',
  );
  const debugInfo = useQuery(
    api.entries.getEntryDebugInfo,
    selectedEntryId && selectedEntryIsSynced ? { entryId: selectedEntryId } : 'skip',
  );
  const queueSyncedEntry = useMutation(api.entries.queueSyncedEntry);
  const startMay16Migration = useMutation(api.entries.startMay16Migration);
  const toggleFavorite = useMutation(api.entries.toggleFavorite);

  useEffect(() => {
    if (migrationStartedRef.current) {
      return;
    }

    migrationStartedRef.current = true;
    void startMay16Migration().catch(() => undefined);
  }, [startMay16Migration]);

  const mappedSyncedSegments = useMemo<DisplayTranscriptSegment[]>(
    () =>
      splitDisplaySegmentsForCaptions({
        segments: (queriedSyncedSegments ?? emptySyncedSegments).map((segment) => ({
          endMs: segment.endMs,
          index: segment.index,
          originalText: segment.originalText,
          sourceChunkIndexes: segment.sourceChunkIndexes,
          startMs: segment.startMs,
          translatedText: segment.translatedText,
        })),
      }),
    [queriedSyncedSegments],
  );

  const syncedDebugReport = useMemo<ProcessingDebugReport | undefined>(() => {
    if (!selectedEntry || !debugInfo) {
      return undefined;
    }

    const latestRun = debugInfo.processingRuns.at(-1);
    const cloudflareCostUsd = debugInfo.usageEvents
      .filter((event) => event.provider === 'cloudflare')
      .reduce(
        (total, event) => total + (event.providerReportedCostUsd ?? event.estimatedCostUsd ?? 0),
        0,
      );
    const openRouterCostUsd = debugInfo.usageEvents
      .filter((event) => event.provider === 'openrouter')
      .reduce(
        (total, event) => total + (event.providerReportedCostUsd ?? event.estimatedCostUsd ?? 0),
        0,
      );

    return {
      chunkCount: debugInfo.chunks.length,
      cloudflareCostUsd,
      durationSec: selectedEntry.durationSec,
      entryId: selectedEntry._id,
      errorMessage: selectedEntry.errorMessage,
      openRouterCostUsd,
      processingStage: selectedEntry.processingStage,
      realtimeFactor: latestRun?.realtimeFactor,
      retryCount: debugInfo.usageEvents.filter((event) => event.status === 'failed').length,
      status: selectedEntry.status,
      timings: {
        downloadSec: latestRun?.downloadSec,
        ffmpegSec: latestRun?.ffmpegSec,
        totalSec: latestRun?.totalSec,
        translationSec: latestRun?.translationSec,
        whisperSec: latestRun?.whisperSec,
      },
      videoTitle: selectedEntry.title,
    };
  }, [debugInfo, selectedEntry]);

  const handleSelectEntry = useCallback((entryId: Id<'entries'>) => {
    setSelectedEntryId(entryId);
  }, []);

  return (
    <HomeScreen
      backendReady
      entries={entries}
      isWorking={isWorking}
      onSelectEntry={handleSelectEntry}
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

          const entryId = await queueSyncedEntry({
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

          setSelectedEntryId(entryId);
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
      selectedEntryId={selectedEntryId}
      syncedDebugReport={syncedDebugReport}
      syncedSegments={mappedSyncedSegments}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
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
          onSelectEntry={() => undefined}
          onToggleFavorite={async () => undefined}
          onTranscribe={async () => null}
          selectedEntryId={null}
          syncedSegments={[]}
        />
      )}
    </SafeAreaProvider>
  );
}
