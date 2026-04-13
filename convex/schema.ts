import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  entries: defineTable({
    channelTitle: v.optional(v.string()),
    createdAt: v.number(),
    errorMessage: v.optional(v.string()),
    sourceLanguage: v.string(),
    sourceLanguageLabel: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('processing'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    targetLanguage: v.string(),
    targetLanguageLabel: v.string(),
    thumbnailUrl: v.string(),
    title: v.string(),
    transcriptText: v.optional(v.string()),
    translationText: v.optional(v.string()),
    updatedAt: v.number(),
    videoId: v.string(),
    youtubeUrl: v.string(),
  }),
});
