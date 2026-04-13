"use node";

import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import type { TranscriptResponse } from 'youtube-transcript';
import { fetchTranscriptLinesFromYouTube, normalizeTranscriptLines } from '../src/lib/youtubeCaptions';
import {
  buildFallbackChapters,
  buildFallbackSummary,
  extractJsonObject,
  type ReaderChapter,
} from '../src/lib/reader';

const youtubeHostnames = new Set([
  'youtu.be',
  'www.youtu.be',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);

const parseYouTubeUrl = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Please paste a YouTube link.');
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Please paste a valid YouTube video or Shorts link.');
  }

  if (!youtubeHostnames.has(url.hostname)) {
    throw new Error('Please paste a valid YouTube video or Shorts link.');
  }

  if (url.hostname.includes('youtu.be')) {
    const videoId = url.pathname.split('/').filter(Boolean)[0];

    if (videoId) {
      return {
        cleanUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
      };
    }
  }

  const pathname = url.pathname.split('/').filter(Boolean);

  if (pathname[0] === 'watch') {
    const videoId = url.searchParams.get('v');

    if (videoId) {
      return {
        cleanUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
      };
    }
  }

  if (pathname[0] === 'shorts' || pathname[0] === 'embed' || pathname[0] === 'live') {
    const videoId = pathname[1];

    if (videoId) {
      return {
        cleanUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
      };
    }
  }

  throw new Error('Please paste a valid YouTube video or Shorts link.');
};

const fetchTranscriptLines = async (
  videoId: string,
  preferredLanguageCode?: string,
): Promise<TranscriptResponse[]> => {
  let packageError: unknown;

  try {
    return await fetchTranscriptLinesFromYouTube(videoId, preferredLanguageCode);
  } catch (error) {
    packageError = error;
  }

  try {
    const { fetchTranscript } = await import('youtube-transcript/dist/youtube-transcript.esm.js');
    return await fetchTranscript(
      videoId,
      preferredLanguageCode && preferredLanguageCode !== 'auto'
        ? { lang: preferredLanguageCode }
        : undefined,
    );
  } catch (error) {
    if (packageError instanceof Error) {
      throw packageError;
    }

    throw error;
  }
};

const splitForTranslation = (text: string, maxChars = 3400) => {
  const paragraphs = text.split('\n\n').filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if (`${current}\n\n${paragraph}`.length > maxChars) {
      chunks.push(current);
      current = paragraph;
      continue;
    }

    current = `${current}\n\n${paragraph}`;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const translateTranscript = async ({
  sourceLanguageCode,
  sourceLanguageLabel,
  targetLanguageLabel,
  targetLanguageCode,
  transcriptText,
}: {
  sourceLanguageCode: string;
  sourceLanguageLabel: string;
  targetLanguageLabel: string;
  targetLanguageCode: string;
  transcriptText: string;
}) => {
  if (
    targetLanguageLabel === 'Auto detect' ||
    sourceLanguageLabel === targetLanguageLabel ||
    sourceLanguageCode === targetLanguageCode
  ) {
    return transcriptText;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model =
    process.env.OPENROUTER_TRANSLATION_MODEL ?? 'google/gemma-4-26b-a4b-it';

  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY in Convex environment variables.');
  }

  const provider = createOpenRouter({ apiKey });
  const translatedChunks: string[] = [];

  for (const chunk of splitForTranslation(transcriptText)) {
    const { text } = await generateText({
      model: provider(model),
      prompt: [
        `Translate the following transcript from ${sourceLanguageLabel} to ${targetLanguageLabel}.`,
        'Keep the meaning faithful, keep paragraph breaks, and return only the translated text.',
        '',
        chunk,
      ].join('\n'),
      temperature: 0.2,
    });

    translatedChunks.push(text.trim());
  }

  return translatedChunks.join('\n\n');
};

const buildReaderExtras = async ({
  model,
  provider,
  readerLanguageLabel,
  readerText,
}: {
  model: string;
  provider: ReturnType<typeof createOpenRouter>;
  readerLanguageLabel: string;
  readerText: string;
}) => {
  const shortenedText = readerText.slice(0, 14000);

  try {
    const { text } = await generateText({
      model: provider(model),
      prompt: [
        `You are creating easy reading notes in ${readerLanguageLabel}.`,
        'Return valid JSON with exactly this shape:',
        '{"summary":"...", "chapters":[{"title":"...", "summary":"..."}]}',
        'Use 3 to 5 chapters. Make the language calm, simple, and helpful for older readers.',
        'Do not include markdown fences or extra commentary.',
        '',
        shortenedText,
      ].join('\n'),
      temperature: 0.2,
    });

    const parsed = extractJsonObject(text) as
      | {
          chapters?: ReaderChapter[];
          summary?: string;
        }
      | null;

    const summaryText = parsed?.summary?.trim();
    const chapters = parsed?.chapters?.filter(
      (chapter) => chapter?.title?.trim() && chapter?.summary?.trim(),
    );

    if (summaryText && chapters && chapters.length > 0) {
      return {
        chapters,
        summaryText,
      };
    }
  } catch {
    // Fall back to heuristic reader notes below.
  }

  return {
    chapters: buildFallbackChapters(readerText),
    summaryText: buildFallbackSummary(readerText),
  };
};

export const processEntry = action({
  args: {
    detectedLanguageCode: v.optional(v.string()),
    entryId: v.id('entries'),
    sourceLanguage: v.string(),
    sourceLanguageLabel: v.string(),
    targetLanguage: v.string(),
    targetLanguageLabel: v.string(),
    transcriptText: v.optional(v.string()),
    youtubeUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { videoId } = parseYouTubeUrl(args.youtubeUrl);
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model =
      process.env.OPENROUTER_TRANSLATION_MODEL ?? 'google/gemma-4-26b-a4b-it';

    try {
      await ctx.runMutation(internal.entries.updateProgress, {
        entryId: args.entryId,
        processingStage: 'Checking the video and getting captions',
        updatedAt: Date.now(),
      });

      let transcriptText = args.transcriptText;
      let detectedLanguageCode = args.detectedLanguageCode ?? args.sourceLanguage;

      if (!transcriptText) {
        const transcriptLines = await fetchTranscriptLines(videoId, args.sourceLanguage);
        transcriptText = normalizeTranscriptLines(transcriptLines);
        detectedLanguageCode =
          transcriptLines.find((line) => line.lang)?.lang ?? args.sourceLanguage;
      }

      if (!transcriptText) {
        throw new Error('No transcript was returned for this video.');
      }

      await ctx.runMutation(internal.entries.updateProgress, {
        entryId: args.entryId,
        processingStage: `Translating to ${args.targetLanguageLabel}`,
        updatedAt: Date.now(),
      });

      let translationText = transcriptText;
      let translationStatus: 'failed' | 'ready' | 'skipped' = 'skipped';
      let translationErrorMessage: string | undefined;

      try {
        translationText = await translateTranscript({
          sourceLanguageCode:
            args.sourceLanguage === 'auto' ? detectedLanguageCode : args.sourceLanguage,
          sourceLanguageLabel:
            args.sourceLanguageLabel === 'Auto detect'
              ? 'the transcript language'
              : args.sourceLanguageLabel,
          targetLanguageLabel: args.targetLanguageLabel,
          targetLanguageCode: args.targetLanguage,
          transcriptText,
        });
        translationStatus = translationText === transcriptText ? 'skipped' : 'ready';
      } catch (error) {
        translationText = transcriptText;
        translationStatus = 'failed';
        translationErrorMessage =
          error instanceof Error ? error.message : 'The translation step did not finish.';
      }

      const readerText =
        translationStatus === 'ready' || translationStatus === 'skipped'
          ? translationText
          : transcriptText;
      const readerLanguageLabel =
        translationStatus === 'failed' ? args.sourceLanguageLabel : args.targetLanguageLabel;

      let summaryText = buildFallbackSummary(readerText);
      let chapters = buildFallbackChapters(readerText);

      if (apiKey) {
        await ctx.runMutation(internal.entries.updateProgress, {
          entryId: args.entryId,
          processingStage: 'Writing an easy summary and simple chapters',
          updatedAt: Date.now(),
        });
        const provider = createOpenRouter({ apiKey });
        const extras = await buildReaderExtras({
          model,
          provider,
          readerLanguageLabel,
          readerText,
        });
        summaryText = extras.summaryText;
        chapters = extras.chapters;
      }

      await ctx.runMutation(internal.entries.updateProgress, {
        entryId: args.entryId,
        processingStage: 'Saving your reader',
        updatedAt: Date.now(),
      });

      await ctx.runMutation(internal.entries.completeEntry, {
        chapters,
        entryId: args.entryId,
        processingStage: 'Ready to read',
        summaryText,
        transcriptText,
        translationErrorMessage,
        translationStatus,
        translationText,
        updatedAt: Date.now(),
      });
    } catch (error) {
      await ctx.runMutation(internal.entries.failEntry, {
        entryId: args.entryId,
        errorMessage: error instanceof Error ? error.message : 'We could not transcribe this video.',
        processingStage: 'We could not finish this video',
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});
