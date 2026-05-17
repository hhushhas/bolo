import { v } from 'convex/values';
import { internal } from './_generated/api';
import { workflow } from './workflow';
import {
  buildTranslationBatches,
  mergeTranscriptSegments,
  type DisplayTranscriptSegment,
  type RawTranscriptSegment,
} from '../src/lib/syncedTranscript';

const translatedBatchToSegments = (
  batches: {
    segments: DisplayTranscriptSegment[];
  }[],
) => batches.flatMap((batch) => batch.segments).sort((left, right) => left.index - right.index);

export const processSyncedVideo = workflow
  .define({
    args: {
      entryId: v.id('entries'),
      migrationReason: v.optional(v.literal('today-entries-reprocess')),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const startedAt = Date.now();

    await step.runMutation(
      internal.entries.beginProcessingRun,
      {
        entryId: args.entryId,
        processingVersion: 2,
        startedAt,
      },
      { inline: true },
    );

    try {
      const entry = await step.runQuery(internal.entries.getEntryForProcessing, {
        entryId: args.entryId,
      });

      if (!entry) {
        throw new Error('Entry not found.');
      }

      if (entry.processingVersion !== 2) {
        throw new Error('Entry is not queued for synced processing.');
      }

      const prepared = await step.runAction(
        internal.syncPipeline.prepareMedia,
        {
          entryId: args.entryId,
          youtubeUrl: entry.youtubeUrl,
        },
        { retry: { base: 2, initialBackoffMs: 10_000, maxAttempts: 4 } },
      );

      await step.runMutation(internal.entries.updateProgress, {
        entryId: args.entryId,
        processingStage: 'Transcribing timed audio chunks',
        updatedAt: Date.now(),
      });

      const transcriptChunks = await Promise.all(
        prepared.chunks.map((chunk) =>
          step.runAction(
            internal.syncPipeline.transcribeChunk,
            {
              chunkDurationMs: chunk.durationMs,
              chunkIndex: chunk.index,
              chunkStartMs: chunk.startMs,
              entryId: args.entryId,
              language: entry.sourceLanguage !== 'auto' ? entry.sourceLanguage : undefined,
              r2Key: chunk.r2Key,
            },
            { retry: { base: 2, initialBackoffMs: 5_000, maxAttempts: 3 } },
          ),
        ),
      );

      const rawSegments: RawTranscriptSegment[] = transcriptChunks.flatMap((chunk) =>
        chunk.segments.map((segment) => ({
          chunkIndex: chunk.chunkIndex,
          endMs: segment.endMs,
          startMs: segment.startMs,
          text: segment.text,
        })),
      );
      const mergedSegments = mergeTranscriptSegments({ segments: rawSegments });

      if (mergedSegments.length === 0) {
        throw new Error('Whisper did not return usable timed transcript segments.');
      }

      await step.runMutation(internal.entries.updateProgress, {
        entryId: args.entryId,
        processingStage: 'Translating timed transcript',
        updatedAt: Date.now(),
      });

      const translatedBatches = await Promise.all(
        buildTranslationBatches({ segments: mergedSegments }).map((batch) => {
          const indexes = new Set(batch.map((item) => Number(item.id)));
          const batchSegments = mergedSegments.filter((segment) => indexes.has(segment.index));

          return step.runAction(
            internal.syncPipeline.translateSegmentBatch,
            {
              entryId: args.entryId,
              segments: batchSegments,
              sourceLanguageLabel: entry.sourceLanguageLabel,
              targetLanguageLabel: entry.targetLanguageLabel,
            },
            { retry: { base: 2, initialBackoffMs: 3_000, maxAttempts: 3 } },
          );
        }),
      );
      const translatedSegments = translatedBatchToSegments(translatedBatches);
      const now = Date.now();
      const totalSec = (now - startedAt) / 1000;
      const whisperSec = transcriptChunks.reduce((total, chunk) => total + chunk.elapsedSec, 0);
      const translationSec = translatedBatches.reduce((total, batch) => total + batch.elapsedSec, 0);

      await step.runMutation(internal.entries.replaceEntrySegments, {
        createdAt: now,
        entryId: args.entryId,
        segments: translatedSegments,
      });
      await step.runMutation(internal.entries.updateProgress, {
        entryId: args.entryId,
        processingStage: 'Cleaning up temporary audio',
        updatedAt: Date.now(),
      });
      await step.runAction(
        internal.syncPipeline.cleanupMediaChunks,
        {
          entryId: args.entryId,
          r2Keys: prepared.chunks.map((chunk) => chunk.r2Key),
        },
        { retry: { base: 2, initialBackoffMs: 3_000, maxAttempts: 3 } },
      );
      await step.runMutation(internal.entries.markEntrySyncedReady, {
        durationSec: prepared.durationSec,
        entryId: args.entryId,
        processingStage: 'Ready for synced playback',
        updatedAt: now,
      });
      await step.runMutation(internal.entries.completeProcessingRun, {
        completedAt: now,
        downloadSec: prepared.downloadSec,
        entryId: args.entryId,
        ffmpegSec: prepared.ffmpegSec,
        realtimeFactor: prepared.durationSec > 0 ? prepared.durationSec / Math.max(totalSec, 1) : undefined,
        totalSec,
        translationSec,
        whisperSec,
      });

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Synced video processing failed.';
      const failedAt = Date.now();

      await step.runMutation(internal.entries.failProcessingRun, {
        entryId: args.entryId,
        errorMessage,
        failedAt,
      });
      await step.runMutation(internal.entries.failEntry, {
        entryId: args.entryId,
        errorMessage,
        processingStage: errorMessage,
        updatedAt: failedAt,
      });

      throw error;
    }
  });
