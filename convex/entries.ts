import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';

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

export const listEntries = query({
  args: {},
  handler: async (ctx) => ctx.db.query('entries').order('desc').take(50),
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
      status: 'queued',
      translationStatus: 'pending',
    }),
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
    status: v.optional(statusValidator),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entryId, {
      processingStage: args.processingStage,
      status: args.status ?? 'processing',
      updatedAt: args.updatedAt,
    });
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
    errorMessage: v.string(),
    processingStage: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entryId, {
      errorMessage: args.errorMessage,
      processingStage: args.processingStage,
      status: 'failed',
      updatedAt: args.updatedAt,
    });
  },
});
