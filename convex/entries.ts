import { internal } from './_generated/api';
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { workflow } from './workflow';

const chapterValidator = v.array(
  v.object({
    summary: v.string(),
    title: v.string(),
  }),
);

const statusValidator = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('ready'),
  v.literal('failed'),
);

const translationStatusValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('failed'),
  v.literal('skipped'),
);

const segmentValidator = v.object({
  endMs: v.number(),
  index: v.number(),
  originalText: v.string(),
  sourceChunkIndexes: v.array(v.number()),
  startMs: v.number(),
  translatedText: v.string(),
});

const mediaChunkStatusValidator = v.union(
  v.literal('prepared'),
  v.literal('transcribing'),
  v.literal('transcribed'),
  v.literal('failed'),
  v.literal('deleted'),
);

const mediaChunkValidator = v.object({
  durationMs: v.number(),
  index: v.number(),
  r2Key: v.string(),
  sha256: v.optional(v.string()),
  sizeBytes: v.number(),
  startMs: v.number(),
  status: mediaChunkStatusValidator,
});

const usageEventValidator = v.object({
  completionTokens: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
  generationId: v.optional(v.string()),
  metadata: v.optional(v.string()),
  model: v.optional(v.string()),
  promptTokens: v.optional(v.number()),
  provider: v.union(
    v.literal('cloudflare'),
    v.literal('groq'),
    v.literal('openrouter'),
    v.literal('internal'),
  ),
  providerReportedCostUsd: v.optional(v.number()),
  providerRequestId: v.optional(v.string()),
  quantity: v.optional(v.number()),
  stage: v.union(
    v.literal('media_prep'),
    v.literal('transcription'),
    v.literal('translation'),
    v.literal('migration'),
    v.literal('cleanup'),
  ),
  status: v.union(v.literal('started'), v.literal('succeeded'), v.literal('failed')),
  totalTokens: v.optional(v.number()),
  unitPriceUsd: v.optional(v.number()),
  unitType: v.optional(
    v.union(
      v.literal('audio_minute'),
      v.literal('token'),
      v.literal('runtime_second'),
      v.literal('request'),
    ),
  ),
});

const createProcessingAttemptId = () => `${Date.now()}-${crypto.randomUUID()}`;

const isActiveProcessingAttempt = async (
  ctx: MutationCtx,
  args: { attemptId?: string; entryId: Id<'entries'> },
) => {
  const entry = await ctx.db.get(args.entryId);

  if (!entry) {
    return false;
  }

  if (args.attemptId) {
    return entry.activeProcessingAttemptId === args.attemptId;
  }

  return false;
};

export const listEntries = query({
  args: {},
  handler: async (ctx) => ctx.db.query('entries').order('desc').take(50),
});

export const listEntrySegments = query({
  args: {
    entryId: v.id('entries'),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query('entrySegments')
      .withIndex('by_entry_index', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
      .collect(),
});

export const getEntryDebugInfo = query({
  args: {
    entryId: v.id('entries'),
  },
  handler: async (ctx, args) => {
    const [entry, segments, chunks, usageEvents, processingRuns] = await Promise.all([
      ctx.db.get(args.entryId),
      ctx.db
        .query('entrySegments')
        .withIndex('by_entry_index', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
      ctx.db
        .query('mediaChunks')
        .withIndex('by_entry_index', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
      ctx.db
        .query('aiUsageEvents')
        .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
      ctx.db
        .query('processingRuns')
        .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
    ]);

    return {
      chunks,
      entry,
      processingRuns,
      segments,
      usageEvents,
    };
  },
});

export const getEntryForProcessing = internalQuery({
  args: {
    entryId: v.id('entries'),
  },
  handler: async (ctx, args) => ctx.db.get(args.entryId),
});

export const getPreparedMediaForProcessing = internalQuery({
  args: {
    entryId: v.id('entries'),
  },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query('mediaChunks')
      .withIndex('by_entry_index', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
      .collect();
    const durationSec =
      chunks.reduce(
        (maxEndMs, chunk) => Math.max(maxEndMs, chunk.startMs + chunk.durationMs),
        0,
      ) / 1000;

    if (chunks.length === 0 || durationSec <= 0) {
      throw new Error('No prepared media chunks found for this entry.');
    }

    return {
      chunkSeconds: chunks[0]?.durationMs ? chunks[0].durationMs / 1000 : 60,
      chunks,
      downloadSec: 0,
      durationSec,
      ffmpegSec: 0,
      totalSec: 0,
    };
  },
});

export const queueEntry = mutation({
  args: {
    channelTitle: v.optional(v.string()),
    createdAt: v.number(),
    processingStage: v.string(),
    sourceLanguage: v.string(),
    sourceLanguageLabel: v.string(),
    targetLanguage: v.string(),
    targetLanguageLabel: v.string(),
    thumbnailUrl: v.string(),
    title: v.string(),
    updatedAt: v.number(),
    videoId: v.string(),
    youtubeUrl: v.string(),
  },
  returns: v.id('entries'),
  handler: async (ctx, args) =>
    ctx.db.insert('entries', {
      ...args,
      favorite: false,
      processingVersion: 1,
      status: 'queued',
      translationStatus: 'pending',
    }),
});

export const queueSyncedEntry = mutation({
  args: {
    channelTitle: v.optional(v.string()),
    createdAt: v.number(),
    processingStage: v.string(),
    sourceLanguage: v.string(),
    sourceLanguageLabel: v.string(),
    targetLanguage: v.string(),
    targetLanguageLabel: v.string(),
    thumbnailUrl: v.string(),
    title: v.string(),
    updatedAt: v.number(),
    videoId: v.string(),
    youtubeUrl: v.string(),
  },
  returns: v.id('entries'),
  handler: async (ctx, args) => {
    const attemptId = createProcessingAttemptId();
    const entryId = await ctx.db.insert('entries', {
      ...args,
      activeProcessingAttemptId: attemptId,
      favorite: true,
      processingVersion: 2,
      status: 'queued',
      translationStatus: 'pending',
    });

    await workflow.start(ctx, internal.syncedVideoWorkflow.processSyncedVideo, {
      attemptId,
      entryId,
    });

    return entryId;
  },
});

export const startMay16Migration = mutation({
  args: {},
  returns: v.object({
    queuedCount: v.number(),
  }),
  handler: async (ctx) => {
    const startOfMay16Pakistan = new Date('2026-05-16T00:00:00+05:00').getTime();
    const startOfMay17Pakistan = new Date('2026-05-17T00:00:00+05:00').getTime();
    const now = Date.now();
    const entries = await ctx.db.query('entries').collect();
    const candidates = entries.filter(
      (entry) =>
        entry.createdAt >= startOfMay16Pakistan &&
        entry.createdAt < startOfMay17Pakistan &&
        entry.processingVersion !== 2,
    );

    for (const entry of candidates) {
      const attemptId = createProcessingAttemptId();

      await ctx.db.patch(entry._id, {
        activeProcessingAttemptId: attemptId,
        migrationReason: 'today-entries-reprocess',
        processingStage: 'Queued for synced video reprocessing',
        processingVersion: 2,
        status: 'queued',
        translationStatus: 'pending',
        updatedAt: now,
      });
      await ctx.db.insert('aiUsageEvents', {
        createdAt: now,
        entryId: entry._id,
        metadata: 'Automatic migration for entries created on Saturday May 16, 2026.',
        provider: 'internal',
        stage: 'migration',
        status: 'succeeded',
        unitType: 'request',
      });
      await workflow.start(ctx, internal.syncedVideoWorkflow.processSyncedVideo, {
        attemptId,
        entryId: entry._id,
        migrationReason: 'today-entries-reprocess',
      });
    }

    return {
      queuedCount: candidates.length,
    };
  },
});

export const toggleFavorite = mutation({
  args: {
    entryId: v.id('entries'),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);

    if (!entry) {
      return;
    }

    await ctx.db.patch(args.entryId, {
      favorite: !entry.favorite,
      updatedAt: Date.now(),
    });
  },
});

export const updateProgress = internalMutation({
  args: {
    entryId: v.id('entries'),
    processingStage: v.string(),
    attemptId: v.optional(v.string()),
    status: v.optional(statusValidator),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    await ctx.db.patch(args.entryId, {
      processingStage: args.processingStage,
      status: args.status ?? 'processing',
      updatedAt: args.updatedAt,
    });
  },
});

export const beginProcessingRun = internalMutation({
  args: {
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    processingVersion: v.number(),
    startedAt: v.number(),
    workflowRunId: v.optional(v.string()),
  },
  returns: v.id('processingRuns'),
  handler: async (ctx, args) =>
    ctx.db.insert('processingRuns', {
      entryId: args.entryId,
      processingAttemptId: args.attemptId,
      processingVersion: args.processingVersion,
      startedAt: args.startedAt,
      status: 'running',
      workflowRunId: args.workflowRunId,
    }),
});

export const completeProcessingRun = internalMutation({
  args: {
    completedAt: v.number(),
    downloadSec: v.optional(v.number()),
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    ffmpegSec: v.optional(v.number()),
    realtimeFactor: v.optional(v.number()),
    totalSec: v.optional(v.number()),
    translationSec: v.optional(v.number()),
    whisperSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    const run = await ctx.db
      .query('processingRuns')
      .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
      .order('desc')
      .first();

    if (!run) return;

    await ctx.db.patch(run._id, {
      completedAt: args.completedAt,
      downloadSec: args.downloadSec,
      ffmpegSec: args.ffmpegSec,
      realtimeFactor: args.realtimeFactor,
      status: 'ready',
      totalSec: args.totalSec,
      translationSec: args.translationSec,
      whisperSec: args.whisperSec,
    });
  },
});

export const failProcessingRun = internalMutation({
  args: {
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    errorMessage: v.string(),
    failedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    const run = await ctx.db
      .query('processingRuns')
      .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
      .order('desc')
      .first();

    if (!run) return;

    await ctx.db.patch(run._id, {
      errorMessage: args.errorMessage,
      failedAt: args.failedAt,
      status: 'failed',
    });
    await ctx.db.patch(args.entryId, {
      activeProcessingAttemptId: undefined,
      errorMessage: args.errorMessage,
      processingStage: args.errorMessage,
      status: 'failed',
      updatedAt: args.failedAt,
    });
  },
});

export const repairStaleFailedEntries = mutation({
  args: {},
  returns: v.object({
    repairedCount: v.number(),
  }),
  handler: async (ctx) => {
    const runs = await ctx.db.query('processingRuns').collect();
    let repairedCount = 0;

    for (const run of runs) {
      if (run.status !== 'failed' || !run.errorMessage || !run.failedAt) {
        continue;
      }

      const entry = await ctx.db.get(run.entryId);

      if (!entry || entry.status !== 'processing') {
        continue;
      }

      await ctx.db.patch(run.entryId, {
        activeProcessingAttemptId: undefined,
        errorMessage: run.errorMessage,
        processingStage: run.errorMessage,
        status: 'failed',
        updatedAt: run.failedAt,
      });
      repairedCount += 1;
    }

    return { repairedCount };
  },
});

export const repairReadyProcessingRuns = mutation({
  args: {},
  returns: v.object({
    repairedCount: v.number(),
  }),
  handler: async (ctx) => {
    const runs = await ctx.db.query('processingRuns').collect();
    let repairedCount = 0;

    for (const run of runs) {
      if (run.status !== 'running') {
        continue;
      }

      const entry = await ctx.db.get(run.entryId);

      if (!entry || entry.status !== 'ready') {
        continue;
      }

      await ctx.db.patch(run._id, {
        completedAt: entry.updatedAt,
        status: 'ready',
      });
      repairedCount += 1;
    }

    return { repairedCount };
  },
});

export const retrySyncedEntry = mutation({
  args: {
    entryId: v.id('entries'),
  },
  returns: v.id('entries'),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);

    if (!entry) {
      throw new Error('Entry not found.');
    }

    if (entry.processingVersion !== 2) {
      throw new Error('Only synced video entries can be retried.');
    }

    const attemptId = createProcessingAttemptId();
    const [chunks, segments] = await Promise.all([
      ctx.db
        .query('mediaChunks')
        .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
      ctx.db
        .query('entrySegments')
        .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
    ]);

    await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)));
    await Promise.all(segments.map((segment) => ctx.db.delete(segment._id)));
    await ctx.db.patch(args.entryId, {
      activeProcessingAttemptId: attemptId,
      errorMessage: undefined,
      processingStage: 'Retrying synced video processing',
      status: 'queued',
      translationErrorMessage: undefined,
      translationStatus: 'pending',
      updatedAt: Date.now(),
    });

    await workflow.start(ctx, internal.syncedVideoWorkflow.processSyncedVideo, {
      attemptId,
      entryId: args.entryId,
    });

    return args.entryId;
  },
});

export const retrySyncedEntryWithPreparedChunks = mutation({
  args: {
    chunks: v.array(mediaChunkValidator),
    entryId: v.id('entries'),
  },
  returns: v.id('entries'),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);

    if (!entry) {
      throw new Error('Entry not found.');
    }

    if (entry.processingVersion !== 2) {
      throw new Error('Only synced video entries can be retried.');
    }

    if (args.chunks.length === 0) {
      throw new Error('Prepared chunks are required.');
    }

    const attemptId = createProcessingAttemptId();
    const [existingChunks, segments] = await Promise.all([
      ctx.db
        .query('mediaChunks')
        .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
      ctx.db
        .query('entrySegments')
        .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
        .collect(),
    ]);

    await Promise.all(existingChunks.map((chunk) => ctx.db.delete(chunk._id)));
    await Promise.all(segments.map((segment) => ctx.db.delete(segment._id)));
    await Promise.all(
      args.chunks.map((chunk) =>
        ctx.db.insert('mediaChunks', {
          ...chunk,
          createdAt: Date.now(),
          entryId: args.entryId,
          updatedAt: Date.now(),
        }),
      ),
    );
    await ctx.db.patch(args.entryId, {
      activeProcessingAttemptId: attemptId,
      errorMessage: undefined,
      processingStage: 'Retrying synced video processing',
      status: 'queued',
      translationErrorMessage: undefined,
      translationStatus: 'pending',
      updatedAt: Date.now(),
    });

    await workflow.start(ctx, internal.syncedVideoWorkflow.processSyncedVideo, {
      attemptId,
      entryId: args.entryId,
      reuseExistingMedia: true,
    });

    return args.entryId;
  },
});

export const replaceMediaChunks = internalMutation({
  args: {
    chunks: v.array(mediaChunkValidator),
    createdAt: v.number(),
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    const existing = await ctx.db
      .query('mediaChunks')
      .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
      .collect();

    await Promise.all(existing.map((chunk) => ctx.db.delete(chunk._id)));
    await Promise.all(
      args.chunks.map((chunk) =>
        ctx.db.insert('mediaChunks', {
          ...chunk,
          createdAt: args.createdAt,
          entryId: args.entryId,
          updatedAt: args.updatedAt,
        }),
      ),
    );
  },
});

export const markMediaChunksDeleted = internalMutation({
  args: {
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    r2Keys: v.array(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    const keys = new Set(args.r2Keys);
    const existing = await ctx.db
      .query('mediaChunks')
      .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
      .collect();

    await Promise.all(
      existing
        .filter((chunk) => keys.has(chunk.r2Key))
        .map((chunk) =>
          ctx.db.patch(chunk._id, {
            status: 'deleted',
            updatedAt: args.updatedAt,
          }),
        ),
    );
  },
});

export const replaceEntrySegments = internalMutation({
  args: {
    createdAt: v.number(),
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    segments: v.array(segmentValidator),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    const existing = await ctx.db
      .query('entrySegments')
      .withIndex('by_entry', (queryBuilder) => queryBuilder.eq('entryId', args.entryId))
      .collect();

    await Promise.all(existing.map((segment) => ctx.db.delete(segment._id)));
    await Promise.all(
      args.segments.map((segment) =>
        ctx.db.insert('entrySegments', {
          ...segment,
          createdAt: args.createdAt,
          entryId: args.entryId,
        }),
      ),
    );
  },
});

export const recordUsageEvent = internalMutation({
  args: {
    createdAt: v.number(),
    entryId: v.id('entries'),
    event: usageEventValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('aiUsageEvents', {
      ...args.event,
      createdAt: args.createdAt,
      entryId: args.entryId,
    });
  },
});

export const markEntrySyncedReady = internalMutation({
  args: {
    durationSec: v.number(),
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    processingStage: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    await ctx.db.patch(args.entryId, {
      activeProcessingAttemptId: undefined,
      durationSec: args.durationSec,
      processingStage: args.processingStage,
      status: 'ready',
      translationStatus: 'ready',
      updatedAt: args.updatedAt,
    });
  },
});

export const listEntriesForMay16Migration = internalQuery({
  args: {},
  handler: async (ctx) => {
    const startOfMay16Pakistan = new Date('2026-05-16T00:00:00+05:00').getTime();
    const startOfMay17Pakistan = new Date('2026-05-17T00:00:00+05:00').getTime();
    const entries = await ctx.db.query('entries').collect();

    return entries.filter(
      (entry) =>
        entry.createdAt >= startOfMay16Pakistan &&
        entry.createdAt < startOfMay17Pakistan &&
        entry.processingVersion !== 2,
    );
  },
});

export const completeEntry = internalMutation({
  args: {
    chapters: chapterValidator,
    entryId: v.id('entries'),
    processingStage: v.optional(v.string()),
    summaryText: v.string(),
    transcriptText: v.string(),
    translationErrorMessage: v.optional(v.string()),
    translationStatus: translationStatusValidator,
    translationText: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entryId, {
      chapters: args.chapters,
      processingStage: args.processingStage,
      status: 'ready',
      summaryText: args.summaryText,
      transcriptText: args.transcriptText,
      translationErrorMessage: args.translationErrorMessage,
      translationStatus: args.translationStatus,
      translationText: args.translationText,
      updatedAt: args.updatedAt,
    });
  },
});

export const failEntry = internalMutation({
  args: {
    entryId: v.id('entries'),
    attemptId: v.optional(v.string()),
    errorMessage: v.string(),
    processingStage: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await isActiveProcessingAttempt(ctx, args))) return;

    await ctx.db.patch(args.entryId, {
      activeProcessingAttemptId: undefined,
      errorMessage: args.errorMessage,
      processingStage: args.processingStage,
      status: 'failed',
      updatedAt: args.updatedAt,
    });
  },
});
