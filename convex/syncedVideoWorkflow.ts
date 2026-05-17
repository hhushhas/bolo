import { v } from 'convex/values';
import { Effect } from 'effect';
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

const WHISPER_CONCURRENCY = 8;
const TRANSLATION_BATCH_MAX_CHARS = 900;
const TRANSLATION_CONCURRENCY = 6;

export const processSyncedVideo = workflow
  .define({
    args: {
      attemptId: v.optional(v.string()),
      entryId: v.id('entries'),
      migrationReason: v.optional(v.literal('today-entries-reprocess')),
      reuseExistingMedia: v.optional(v.boolean()),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const startedAt = Date.now();

    await step.runMutation(
      internal.entries.beginProcessingRun,
      {
        attemptId: args.attemptId,
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

      const prepared = args.reuseExistingMedia
        ? await step.runQuery(internal.entries.getPreparedMediaForProcessing, {
            entryId: args.entryId,
          })
        : await step.runAction(
            internal.syncPipeline.prepareMedia,
            {
              attemptId: args.attemptId,
              entryId: args.entryId,
              youtubeUrl: entry.youtubeUrl,
            },
            { retry: { base: 2, initialBackoffMs: 10_000, maxAttempts: 1 } },
          );

      await step.runMutation(internal.entries.updateProgress, {
        attemptId: args.attemptId,
        entryId: args.entryId,
        processingStage: 'Transcribing timed audio chunks',
        updatedAt: Date.now(),
      });

      const transcriptChunks = await Effect.runPromise(
        Effect.all(
          prepared.chunks.map((chunk) =>
            Effect.tryPromise({
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              try: () =>
                step.runAction(
                  internal.syncPipeline.transcribeChunk,
                  {
                    attemptId: args.attemptId,
                    chunkDurationMs: chunk.durationMs,
                    chunkIndex: chunk.index,
                    chunkStartMs: chunk.startMs,
                    entryId: args.entryId,
                    language: entry.sourceLanguage !== 'auto' ? entry.sourceLanguage : undefined,
                    r2Key: chunk.r2Key,
                  },
                  { retry: { base: 2, initialBackoffMs: 5_000, maxAttempts: 3 } },
                ),
            }),
          ),
          { concurrency: WHISPER_CONCURRENCY },
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
        attemptId: args.attemptId,
        entryId: args.entryId,
        processingStage: 'Translating timed transcript',
        updatedAt: Date.now(),
      });

      const translationBatches = buildTranslationBatches({
        maxChars: TRANSLATION_BATCH_MAX_CHARS,
        segments: mergedSegments,
      });
      const translateSegmentsWithFallback = async (
        batchSegments: DisplayTranscriptSegment[],
      ): Promise<{
        elapsedSec: number;
        segments: DisplayTranscriptSegment[];
      }> => {
        try {
          return await step.runAction(
            internal.syncPipeline.translateSegmentBatch,
            {
              attemptId: args.attemptId,
              entryId: args.entryId,
              segments: batchSegments,
              sourceLanguageLabel: entry.sourceLanguageLabel,
              targetLanguageLabel: entry.targetLanguageLabel,
            },
            { retry: { base: 2, initialBackoffMs: 3_000, maxAttempts: 3 } },
          );
        } catch (error) {
          if (batchSegments.length <= 1) {
            throw error;
          }

          const splitIndex = Math.ceil(batchSegments.length / 2);
          const [left, right] = await Promise.all([
            translateSegmentsWithFallback(batchSegments.slice(0, splitIndex)),
            translateSegmentsWithFallback(batchSegments.slice(splitIndex)),
          ]);

          return {
            elapsedSec: left.elapsedSec + right.elapsedSec,
            segments: [...left.segments, ...right.segments],
          };
        }
      };
      const translatedBatches = await Effect.runPromise(
        Effect.all(
          translationBatches.map((batch) =>
            Effect.tryPromise({
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              try: () => {
                const indexes = new Set(batch.map((item) => Number(item.id)));
                const batchSegments = mergedSegments.filter((segment) => indexes.has(segment.index));

                return translateSegmentsWithFallback(batchSegments);
              },
            }),
          ),
          { concurrency: TRANSLATION_CONCURRENCY },
        ),
      );
      const translatedSegments = translatedBatchToSegments(translatedBatches);
      const now = Date.now();
      const totalSec = (now - startedAt) / 1000;
      const whisperSec = transcriptChunks.reduce((total, chunk) => total + chunk.elapsedSec, 0);
      const translationSec = translatedBatches.reduce((total, batch) => total + batch.elapsedSec, 0);

      await step.runMutation(internal.entries.replaceEntrySegments, {
        attemptId: args.attemptId,
        createdAt: now,
        entryId: args.entryId,
        segments: translatedSegments,
      });
      await step.runMutation(internal.entries.updateProgress, {
        attemptId: args.attemptId,
        entryId: args.entryId,
        processingStage: 'Cleaning up temporary audio',
        updatedAt: Date.now(),
      });
      await step.runAction(
        internal.syncPipeline.cleanupMediaChunks,
        {
          attemptId: args.attemptId,
          entryId: args.entryId,
          r2Keys: prepared.chunks.map((chunk) => chunk.r2Key),
        },
        { retry: { base: 2, initialBackoffMs: 3_000, maxAttempts: 3 } },
      );
      await step.runMutation(internal.entries.completeProcessingRun, {
        attemptId: args.attemptId,
        completedAt: now,
        downloadSec: prepared.downloadSec,
        entryId: args.entryId,
        ffmpegSec: prepared.ffmpegSec,
        realtimeFactor: prepared.durationSec > 0 ? prepared.durationSec / Math.max(totalSec, 1) : undefined,
        totalSec,
        translationSec,
        whisperSec,
      });
      await step.runMutation(internal.entries.markEntrySyncedReady, {
        attemptId: args.attemptId,
        durationSec: prepared.durationSec,
        entryId: args.entryId,
        processingStage: 'Ready for synced playback',
        updatedAt: now,
      });

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Synced video processing failed.';
      const failedAt = Date.now();

      await step.runMutation(internal.entries.failProcessingRun, {
        attemptId: args.attemptId,
        entryId: args.entryId,
        errorMessage,
        failedAt,
      });
      await step.runMutation(internal.entries.failEntry, {
        attemptId: args.attemptId,
        entryId: args.entryId,
        errorMessage,
        processingStage: errorMessage,
        updatedAt: failedAt,
      });

      throw error;
    }
  });
