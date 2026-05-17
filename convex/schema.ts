import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  entries: defineTable({
    chapters: v.optional(
      v.array(
        v.object({
          summary: v.string(),
          title: v.string(),
        }),
      ),
    ),
    channelTitle: v.optional(v.string()),
    createdAt: v.number(),
    errorMessage: v.optional(v.string()),
    favorite: v.optional(v.boolean()),
    migrationReason: v.optional(v.literal('today-entries-reprocess')),
    processingVersion: v.optional(v.number()),
    processingStage: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    sourceLanguage: v.string(),
    sourceLanguageLabel: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('processing'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    summaryText: v.optional(v.string()),
    targetLanguage: v.string(),
    targetLanguageLabel: v.string(),
    thumbnailUrl: v.string(),
    title: v.string(),
    translationErrorMessage: v.optional(v.string()),
    translationStatus: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('ready'),
        v.literal('failed'),
        v.literal('skipped'),
      ),
    ),
    transcriptText: v.optional(v.string()),
    translationText: v.optional(v.string()),
    updatedAt: v.number(),
    videoId: v.string(),
    youtubeUrl: v.string(),
  }),
  entrySegments: defineTable({
    createdAt: v.number(),
    endMs: v.number(),
    entryId: v.id('entries'),
    index: v.number(),
    originalText: v.string(),
    sourceChunkIndexes: v.array(v.number()),
    startMs: v.number(),
    translatedText: v.string(),
  })
    .index('by_entry', ['entryId'])
    .index('by_entry_index', ['entryId', 'index'])
    .index('by_entry_start', ['entryId', 'startMs']),
  mediaChunks: defineTable({
    createdAt: v.number(),
    durationMs: v.number(),
    entryId: v.id('entries'),
    index: v.number(),
    r2Key: v.string(),
    sha256: v.optional(v.string()),
    sizeBytes: v.number(),
    startMs: v.number(),
    status: v.union(
      v.literal('prepared'),
      v.literal('transcribing'),
      v.literal('transcribed'),
      v.literal('failed'),
      v.literal('deleted'),
    ),
    updatedAt: v.number(),
  })
    .index('by_entry', ['entryId'])
    .index('by_entry_index', ['entryId', 'index']),
  aiUsageEvents: defineTable({
    completionTokens: v.optional(v.number()),
    createdAt: v.number(),
    entryId: v.id('entries'),
    estimatedCostUsd: v.optional(v.number()),
    generationId: v.optional(v.string()),
    metadata: v.optional(v.string()),
    model: v.optional(v.string()),
    promptTokens: v.optional(v.number()),
    provider: v.union(v.literal('cloudflare'), v.literal('openrouter'), v.literal('internal')),
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
  })
    .index('by_entry', ['entryId'])
    .index('by_entry_stage', ['entryId', 'stage']),
  processingRuns: defineTable({
    completedAt: v.optional(v.number()),
    downloadSec: v.optional(v.number()),
    entryId: v.id('entries'),
    errorMessage: v.optional(v.string()),
    failedAt: v.optional(v.number()),
    ffmpegSec: v.optional(v.number()),
    processingVersion: v.number(),
    realtimeFactor: v.optional(v.number()),
    startedAt: v.number(),
    status: v.union(v.literal('running'), v.literal('ready'), v.literal('failed')),
    totalSec: v.optional(v.number()),
    translationSec: v.optional(v.number()),
    whisperSec: v.optional(v.number()),
    workflowRunId: v.optional(v.string()),
  }).index('by_entry', ['entryId']),
});
