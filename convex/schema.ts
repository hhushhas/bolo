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
    processingStage: v.optional(v.string()),
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
});
