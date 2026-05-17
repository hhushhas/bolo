"use node";

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import {
  applySegmentTranslations,
  buildSegmentTranslationPrompt,
  parseSegmentTranslations,
  type DisplayTranscriptSegment,
} from '../src/lib/syncedTranscript';

const chunkValidator = v.object({
  durationMs: v.number(),
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
});

const displaySegmentValidator = v.object({
  endMs: v.number(),
  index: v.number(),
  originalText: v.string(),
  sourceChunkIndexes: v.array(v.number()),
  startMs: v.number(),
  translatedText: v.string(),
});

const translatedSegmentValidator = v.object({
  endMs: v.number(),
  index: v.number(),
  originalText: v.string(),
  sourceChunkIndexes: v.array(v.number()),
  startMs: v.number(),
  translatedText: v.string(),
});

const whisperSegmentValidator = v.object({
  avgLogprob: v.optional(v.number()),
  compressionRatio: v.optional(v.number()),
  endMs: v.number(),
  index: v.number(),
  noSpeechProbability: v.optional(v.number()),
  startMs: v.number(),
  text: v.string(),
});

const envByName = {
  BOLO_CONTAINER_SECRET: () => process.env.BOLO_CONTAINER_SECRET,
  BOLO_MEDIA_PREP_URL: () => process.env.BOLO_MEDIA_PREP_URL,
  BOLO_WHISPER_WORKER_URL: () => process.env.BOLO_WHISPER_WORKER_URL,
  BOLO_WORKER_SECRET: () => process.env.BOLO_WORKER_SECRET,
  OPENROUTER_API_KEY: () => process.env.OPENROUTER_API_KEY,
} as const;

const createJobId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;
const MEDIA_PREP_TIMEOUT_MS = 8.5 * 60_000;
const WHISPER_TIMEOUT_MS = 6 * 60_000;
const TRANSLATION_TIMEOUT_MS = 90_000;
const TRANSLATION_MAX_OUTPUT_TOKENS = 2_500;

const requireEnv = (name: keyof typeof envByName) => {
  const value = envByName[name]();

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
};

const formatDuration = (durationMs: number) => `${Math.round(durationMs / 1000)}s`;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const fetchJson = async <T>(
  url: string,
  init: RequestInit,
  options: {
    serviceName: string;
    timeoutMs?: number;
  },
) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const reason = getErrorMessage(error);

    if (controller.signal.aborted) {
      throw new Error(
        `${options.serviceName} timed out after ${formatDuration(timeoutMs)}. This is a backend processing issue; the media-prep job did not return before Convex's action time limit.`,
      );
    }

    throw new Error(
      `${options.serviceName} is unreachable from Convex (${reason}). This is a backend processing issue; please retry.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let parsed: (T & { details?: string; error?: string }) | null = null;

  if (text) {
    try {
      parsed = JSON.parse(text) as T & { details?: string; error?: string };
    } catch {
      if (!response.ok) {
        throw new Error(`${options.serviceName} returned status ${response.status}: ${text.slice(0, 500)}`);
      }

      throw new Error(`${options.serviceName} returned non-JSON response: ${text.slice(0, 500)}`);
    }
  }

  if (!response.ok) {
    throw new Error(
      parsed?.details
        ? `${options.serviceName} failed with status ${response.status}: ${parsed.error}: ${parsed.details}`
        : `${options.serviceName} failed with status ${response.status}: ${
            parsed?.error ?? 'Request failed.'
          }`,
    );
  }

  if (!parsed) {
    throw new Error(`${options.serviceName} returned an empty response.`);
  }

  return parsed;
};

export const prepareMedia = internalAction({
  args: {
    entryId: v.id('entries'),
    youtubeUrl: v.string(),
  },
  returns: v.object({
    chunkSeconds: v.number(),
    chunks: v.array(chunkValidator),
    downloadSec: v.number(),
    durationSec: v.number(),
    ffmpegSec: v.number(),
    totalSec: v.number(),
  }),
  handler: async (ctx, args) => {
    const mediaPrepUrl = requireEnv('BOLO_MEDIA_PREP_URL');
    const secret = requireEnv('BOLO_CONTAINER_SECRET');
    const startedAt = Date.now();

    await ctx.runMutation(internal.entries.updateProgress, {
      entryId: args.entryId,
      processingStage: 'Downloading and preparing audio',
      updatedAt: Date.now(),
    });

    let result: {
      chunkSeconds: number;
      chunks: {
        durationMs: number;
        index: number;
        r2Key: string;
        sha256?: string;
        sizeBytes: number;
        startMs: number;
        status: 'prepared';
      }[];
      downloadSec: number;
      durationSec: number;
      ffmpegSec: number;
      totalSec: number;
    };

    try {
      result = await fetchJson(`${mediaPrepUrl.replace(/\/$/, '')}/prepare`, {
        body: JSON.stringify({
          entryId: args.entryId,
          jobId: createJobId(),
          youtubeUrl: args.youtubeUrl,
        }),
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      }, {
        serviceName: 'Cloudflare media prep',
        timeoutMs: MEDIA_PREP_TIMEOUT_MS,
      });
    } catch (error) {
      await ctx.runMutation(internal.entries.recordUsageEvent, {
        createdAt: Date.now(),
        entryId: args.entryId,
        event: {
          metadata: getErrorMessage(error),
          provider: 'cloudflare',
          quantity: (Date.now() - startedAt) / 1000,
          stage: 'media_prep',
          status: 'failed',
          unitType: 'runtime_second',
        },
      });

      throw error;
    }

    const now = Date.now();

    await ctx.runMutation(internal.entries.replaceMediaChunks, {
      chunks: result.chunks,
      createdAt: now,
      entryId: args.entryId,
      updatedAt: now,
    });
    await ctx.runMutation(internal.entries.recordUsageEvent, {
      createdAt: now,
      entryId: args.entryId,
      event: {
        metadata: JSON.stringify({
          downloadSec: result.downloadSec,
          ffmpegSec: result.ffmpegSec,
          totalSec: result.totalSec,
        }),
        provider: 'cloudflare',
        quantity: result.totalSec,
        stage: 'media_prep',
        status: 'succeeded',
        unitType: 'runtime_second',
      },
    });

    return result;
  },
});

export const cleanupMediaChunks = internalAction({
  args: {
    entryId: v.id('entries'),
    r2Keys: v.array(v.string()),
  },
  returns: v.object({
    deletedCount: v.number(),
    elapsedSec: v.number(),
  }),
  handler: async (ctx, args) => {
    const whisperUrl = requireEnv('BOLO_WHISPER_WORKER_URL');
    const secret = requireEnv('BOLO_WORKER_SECRET');
    const startedAt = Date.now();

    try {
      const result = await fetchJson<{
        deletedCount: number;
      }>(`${whisperUrl.replace(/\/$/, '')}/cleanup`, {
        body: JSON.stringify({
          entryId: args.entryId,
          r2Keys: args.r2Keys,
        }),
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      }, {
        serviceName: 'Cloudflare cleanup worker',
        timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
      });
      const elapsedSec = (Date.now() - startedAt) / 1000;

      await ctx.runMutation(internal.entries.markMediaChunksDeleted, {
        entryId: args.entryId,
        r2Keys: args.r2Keys,
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.entries.recordUsageEvent, {
        createdAt: Date.now(),
        entryId: args.entryId,
        event: {
          metadata: JSON.stringify({ deletedCount: result.deletedCount }),
          provider: 'cloudflare',
          quantity: elapsedSec,
          stage: 'cleanup',
          status: 'succeeded',
          unitType: 'runtime_second',
        },
      });

      return {
        deletedCount: result.deletedCount,
        elapsedSec,
      };
    } catch (error) {
      await ctx.runMutation(internal.entries.recordUsageEvent, {
        createdAt: Date.now(),
        entryId: args.entryId,
        event: {
          metadata: error instanceof Error ? error.message : 'Cleanup failed.',
          provider: 'cloudflare',
          stage: 'cleanup',
          status: 'failed',
        },
      });

      throw error;
    }
  },
});

export const transcribeChunk = internalAction({
  args: {
    chunkDurationMs: v.number(),
    chunkIndex: v.number(),
    chunkStartMs: v.number(),
    entryId: v.id('entries'),
    initialPrompt: v.optional(v.string()),
    language: v.optional(v.string()),
    r2Key: v.string(),
  },
  returns: v.object({
    audioMinutes: v.number(),
    chunkIndex: v.number(),
    chunkStartMs: v.number(),
    elapsedSec: v.number(),
    estimatedCostUsd: v.number(),
    entryId: v.string(),
    model: v.string(),
    segments: v.array(whisperSegmentValidator),
    text: v.optional(v.string()),
    unitPriceUsd: v.number(),
    vtt: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const whisperUrl = requireEnv('BOLO_WHISPER_WORKER_URL');
    const secret = requireEnv('BOLO_WORKER_SECRET');
    const startedAt = Date.now();

    const result = await fetchJson<{
      audioMinutes: number;
      chunkIndex: number;
      chunkStartMs: number;
      estimatedCostUsd: number;
      entryId: string;
      model: string;
      segments: {
        avgLogprob?: number;
        compressionRatio?: number;
        endMs: number;
        index: number;
        noSpeechProbability?: number;
        startMs: number;
        text: string;
      }[];
      text?: string;
      unitPriceUsd: number;
      vtt?: string;
    }>(whisperUrl, {
      body: JSON.stringify(args),
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    }, {
      serviceName: 'Cloudflare Whisper worker',
      timeoutMs: WHISPER_TIMEOUT_MS,
    });
    const elapsedSec = (Date.now() - startedAt) / 1000;

    await ctx.runMutation(internal.entries.recordUsageEvent, {
      createdAt: Date.now(),
      entryId: args.entryId,
      event: {
        estimatedCostUsd: result.estimatedCostUsd,
        model: result.model,
        provider: 'cloudflare',
        quantity: result.audioMinutes,
        stage: 'transcription',
        status: 'succeeded',
        unitPriceUsd: result.unitPriceUsd,
        unitType: 'audio_minute',
      },
    });

    return {
      audioMinutes: result.audioMinutes,
      chunkIndex: result.chunkIndex,
      chunkStartMs: result.chunkStartMs,
      elapsedSec,
      entryId: result.entryId,
      estimatedCostUsd: result.estimatedCostUsd,
      model: result.model,
      segments: result.segments,
      text: result.text,
      unitPriceUsd: result.unitPriceUsd,
      vtt: result.vtt,
    };
  },
});

export const translateSegmentBatch = internalAction({
  args: {
    entryId: v.id('entries'),
    segments: v.array(displaySegmentValidator),
    sourceLanguageLabel: v.string(),
    targetLanguageLabel: v.string(),
  },
  returns: v.object({
    elapsedSec: v.number(),
    segments: v.array(translatedSegmentValidator),
  }),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const apiKey = requireEnv('OPENROUTER_API_KEY');
    const model = process.env.OPENROUTER_TRANSLATION_MODEL ?? 'google/gemma-4-26b-a4b-it';
    const provider = createOpenRouter({ apiKey });
    const items = args.segments.map((segment) => ({
      id: String(segment.index),
      originalText: segment.originalText,
    }));

    try {
      const { providerMetadata, text, usage } = await generateText({
        maxOutputTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
        model: provider(model, {
          usage: {
            include: true,
          },
        }),
        prompt: buildSegmentTranslationPrompt({
          items,
          sourceLanguageLabel: args.sourceLanguageLabel,
          targetLanguageLabel: args.targetLanguageLabel,
        }),
        temperature: 0.2,
        timeout: TRANSLATION_TIMEOUT_MS,
      });
      const translations = parseSegmentTranslations({
        expectedIds: items.map((item) => item.id),
        text,
      });
      const translatedSegments = applySegmentTranslations({
        segments: args.segments as DisplayTranscriptSegment[],
        translations,
      });
      const openRouterUsage = providerMetadata?.openrouter?.usage as
        | {
            cost?: number;
            totalTokens?: number;
          }
        | undefined;

      await ctx.runMutation(internal.entries.recordUsageEvent, {
        createdAt: Date.now(),
        entryId: args.entryId,
        event: {
          completionTokens: usage.outputTokens,
          estimatedCostUsd: openRouterUsage?.cost,
          metadata: JSON.stringify({ totalTokens: openRouterUsage?.totalTokens }),
          model,
          promptTokens: usage.inputTokens,
          provider: 'openrouter',
          providerReportedCostUsd: openRouterUsage?.cost,
          quantity: usage.totalTokens,
          stage: 'translation',
          status: 'succeeded',
          totalTokens: usage.totalTokens,
          unitType: 'token',
        },
      });

      return {
        elapsedSec: (Date.now() - startedAt) / 1000,
        segments: translatedSegments,
      };
    } catch (error) {
      await ctx.runMutation(internal.entries.recordUsageEvent, {
        createdAt: Date.now(),
        entryId: args.entryId,
        event: {
          metadata: JSON.stringify({
            batchSize: items.length,
            error: getErrorMessage(error),
            maxOutputTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
            timeoutSec: TRANSLATION_TIMEOUT_MS / 1000,
          }),
          model,
          provider: 'openrouter',
          stage: 'translation',
          status: 'failed',
        },
      });

      throw error;
    }
  },
});
