"use node";

import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { TranscriptResponse } from 'youtube-transcript';

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

const getYouTubeThumbnailUrl = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

const normalizeTranscript = (lines: TranscriptResponse[]) => {
  const chunks: string[] = [];
  let paragraph = '';

  for (const line of lines) {
    const next = line.text.replace(/\s+/g, ' ').trim();

    if (!next) {
      continue;
    }

    paragraph = paragraph ? `${paragraph} ${next}` : next;

    if (paragraph.length >= 280 || /[.!?]$/.test(next)) {
      chunks.push(paragraph);
      paragraph = '';
    }
  }

  if (paragraph) {
    chunks.push(paragraph);
  }

  return chunks.join('\n\n');
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

const fetchMetadata = async (cleanUrl: string, videoId: string) => {
  const response = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`,
  );

  if (!response.ok) {
    return {
      channelTitle: undefined,
      thumbnailUrl: getYouTubeThumbnailUrl(videoId),
      title: 'YouTube video',
    };
  }

  const data = await response.json();

  return {
    channelTitle: data.author_name as string | undefined,
    thumbnailUrl: (data.thumbnail_url as string | undefined) ?? getYouTubeThumbnailUrl(videoId),
    title: (data.title as string | undefined) ?? 'YouTube video',
  };
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
  const model = process.env.OPENROUTER_TRANSLATION_MODEL ?? 'openai/gpt-4o-mini';

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

export const transcribeVideo = action({
  args: {
    sourceLanguage: v.string(),
    sourceLanguageLabel: v.string(),
    targetLanguage: v.string(),
    targetLanguageLabel: v.string(),
    youtubeUrl: v.string(),
  },
  returns: v.id('entries'),
  handler: async (ctx, args): Promise<Id<'entries'>> => {
    const { cleanUrl, videoId } = parseYouTubeUrl(args.youtubeUrl);
    const metadata = await fetchMetadata(cleanUrl, videoId);
    const timestamp = Date.now();

    const entryId: Id<'entries'> = await ctx.runMutation(internal.entries.createEntry, {
      ...args,
      ...metadata,
      createdAt: timestamp,
      status: 'processing',
      updatedAt: timestamp,
      videoId,
      youtubeUrl: cleanUrl,
    });

    try {
      const { fetchTranscript } = await import('youtube-transcript/dist/youtube-transcript.esm.js');
      const transcriptLines = await fetchTranscript(videoId);
      const transcriptText = normalizeTranscript(transcriptLines);
      const detectedLanguageCode = transcriptLines.find((line) => line.lang)?.lang ?? args.sourceLanguage;

      if (!transcriptText) {
        throw new Error('No transcript was returned for this video.');
      }

      const translationText = await translateTranscript({
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

      await ctx.runMutation(internal.entries.completeEntry, {
        entryId,
        transcriptText,
        translationText,
        updatedAt: Date.now(),
      });
    } catch (error) {
      await ctx.runMutation(internal.entries.failEntry, {
        entryId,
        errorMessage: error instanceof Error ? error.message : 'We could not transcribe this video.',
        updatedAt: Date.now(),
      });
    }

    return entryId;
  },
});
