import { internalMutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listEntries = query({
  args: {},
  handler: async (ctx) => ctx.db.query('entries').order('desc').take(20),
});

export const createEntry = internalMutation({
  args: {
    channelTitle: v.optional(v.string()),
    createdAt: v.number(),
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
    updatedAt: v.number(),
    videoId: v.string(),
    youtubeUrl: v.string(),
  },
  returns: v.id('entries'),
  handler: async (ctx, args) => ctx.db.insert('entries', args),
});

export const completeEntry = internalMutation({
  args: {
    entryId: v.id('entries'),
    transcriptText: v.string(),
    translationText: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entryId, {
      status: 'ready',
      transcriptText: args.transcriptText,
      translationText: args.translationText,
      updatedAt: args.updatedAt,
    });
  },
});

export const failEntry = internalMutation({
  args: {
    entryId: v.id('entries'),
    errorMessage: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entryId, {
      errorMessage: args.errorMessage,
      status: 'failed',
      updatedAt: args.updatedAt,
    });
  },
});
