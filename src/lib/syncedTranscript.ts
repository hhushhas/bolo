export type RawTranscriptSegment = {
  chunkIndex: number;
  endMs: number;
  startMs: number;
  text: string;
};

export type DisplayTranscriptSegment = {
  endMs: number;
  index: number;
  originalText: string;
  sourceChunkIndexes: number[];
  startMs: number;
  translatedText: string;
};

export type ChunkLocalTranscriptSegment = {
  endSec?: number;
  endMs?: number;
  startSec?: number;
  startMs?: number;
  text: string;
};

export type ProcessingDebugReport = {
  chunkCount: number;
  cloudflareCostUsd?: number;
  durationSec?: number;
  entryId: string;
  errorMessage?: string;
  openRouterCostUsd?: number;
  processingStage?: string;
  realtimeFactor?: number;
  retryCount?: number;
  status: string;
  timings?: {
    downloadSec?: number;
    ffmpegSec?: number;
    totalSec?: number;
    translationSec?: number;
    whisperSec?: number;
  };
  videoTitle?: string;
};

export type TranslationBatchItem = {
  id: string;
  originalText: string;
};

export type SegmentTranslation = {
  id: string;
  translatedText: string;
};

const sentenceEndingPattern = /[.!?؟۔]$/;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const getSegmentDurationMs = (segment: RawTranscriptSegment) =>
  Math.max(0, segment.endMs - segment.startMs);

const shouldFlushSegment = ({
  candidateDurationMs,
  candidateText,
  maxDurationMs,
  minDurationMs,
}: {
  candidateDurationMs: number;
  candidateText: string;
  maxDurationMs: number;
  minDurationMs: number;
}) => {
  if (candidateDurationMs >= maxDurationMs) {
    return true;
  }

  return candidateDurationMs >= minDurationMs && sentenceEndingPattern.test(candidateText);
};

export const shiftChunkSegments = ({
  chunkIndex,
  chunkStartMs,
  segments,
}: {
  chunkIndex: number;
  chunkStartMs: number;
  segments: ChunkLocalTranscriptSegment[];
}): RawTranscriptSegment[] =>
  segments.flatMap((segment) => {
    const text = normalizeWhitespace(segment.text);

    if (!text) {
      return [];
    }

    const localStartMs =
      segment.startMs ?? Math.round((segment.startSec ?? 0) * 1000);
    const localEndMs =
      segment.endMs ?? Math.round((segment.endSec ?? segment.startSec ?? 0) * 1000);

    return [
      {
        chunkIndex,
        endMs: chunkStartMs + Math.max(localEndMs, localStartMs),
        startMs: chunkStartMs + localStartMs,
        text,
      },
    ];
  });

export const mergeTranscriptSegments = ({
  maxDurationMs = 6000,
  minDurationMs = 2500,
  segments,
}: {
  maxDurationMs?: number;
  minDurationMs?: number;
  segments: RawTranscriptSegment[];
}): DisplayTranscriptSegment[] => {
  const sortedSegments = [...segments]
    .map((segment) => ({
      ...segment,
      text: normalizeWhitespace(segment.text),
    }))
    .filter((segment) => segment.text && getSegmentDurationMs(segment) > 0)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  const merged: DisplayTranscriptSegment[] = [];
  let currentSegments: RawTranscriptSegment[] = [];

  const flush = () => {
    if (currentSegments.length === 0) {
      return;
    }

    const startMs = currentSegments[0]?.startMs ?? 0;
    const endMs = Math.max(...currentSegments.map((segment) => segment.endMs));
    const sourceChunkIndexes = [...new Set(currentSegments.map((segment) => segment.chunkIndex))];
    const originalText = normalizeWhitespace(
      currentSegments.map((segment) => segment.text).join(' '),
    );

    if (originalText) {
      merged.push({
        endMs,
        index: merged.length,
        originalText,
        sourceChunkIndexes,
        startMs,
        translatedText: '',
      });
    }

    currentSegments = [];
  };

  for (const segment of sortedSegments) {
    currentSegments.push(segment);

    const startMs = currentSegments[0]?.startMs ?? segment.startMs;
    const endMs = Math.max(...currentSegments.map((value) => value.endMs));
    const candidateDurationMs = endMs - startMs;
    const candidateText = normalizeWhitespace(
      currentSegments.map((value) => value.text).join(' '),
    );

    if (
      shouldFlushSegment({
        candidateDurationMs,
        candidateText,
        maxDurationMs,
        minDurationMs,
      })
    ) {
      flush();
    }
  }

  flush();

  return merged;
};

const splitCaptionText = (text: string, maxChars: number) => {
  const words = normalizeWhitespace(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (current && next.length > maxChars) {
      lines.push(current);
      current = word;
      continue;
    }

    current = next;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [normalizeWhitespace(text)];
};

export const splitDisplaySegmentsForCaptions = ({
  maxChars = 72,
  segments,
}: {
  maxChars?: number;
  segments: DisplayTranscriptSegment[];
}): DisplayTranscriptSegment[] => {
  const captionSegments = segments.flatMap((segment) => {
    const displayText = segment.translatedText || segment.originalText;
    const parts = splitCaptionText(displayText, maxChars);

    if (parts.length <= 1) {
      return [segment];
    }

    const durationMs = Math.max(1, segment.endMs - segment.startMs);
    const sliceMs = durationMs / parts.length;

    return parts.map((part, index) => ({
      ...segment,
      endMs: Math.round(index === parts.length - 1 ? segment.endMs : segment.startMs + sliceMs * (index + 1)),
      startMs: Math.round(segment.startMs + sliceMs * index),
      translatedText: segment.translatedText ? part : '',
      originalText: segment.translatedText ? segment.originalText : part,
    }));
  });

  return captionSegments.map((segment, index) => ({
    ...segment,
    index,
  }));
};

export const estimateCloudflareWhisperCost = ({
  audioMinutes,
  includedDailyAudioMinutes = 10000 / 46.63,
  unitPriceUsd = 0.00051,
}: {
  audioMinutes: number;
  includedDailyAudioMinutes?: number;
  unitPriceUsd?: number;
}) => ({
  billableAudioMinutes: Math.max(0, audioMinutes - includedDailyAudioMinutes),
  listPriceUsd: audioMinutes * unitPriceUsd,
  unitPriceUsd,
});

export const buildTranslationBatches = ({
  maxChars = 3200,
  segments,
}: {
  maxChars?: number;
  segments: DisplayTranscriptSegment[];
}) => {
  const batches: TranslationBatchItem[][] = [];
  let currentBatch: TranslationBatchItem[] = [];
  let currentLength = 0;

  const flush = () => {
    if (currentBatch.length === 0) {
      return;
    }

    batches.push(currentBatch);
    currentBatch = [];
    currentLength = 0;
  };

  for (const segment of segments) {
    const item = {
      id: String(segment.index),
      originalText: segment.originalText,
    };
    const itemLength = JSON.stringify(item).length;

    if (currentBatch.length > 0 && currentLength + itemLength > maxChars) {
      flush();
    }

    currentBatch.push(item);
    currentLength += itemLength;
  }

  flush();

  return batches;
};

export const buildSegmentTranslationPrompt = ({
  items,
  sourceLanguageLabel,
  targetLanguageLabel,
}: {
  items: TranslationBatchItem[];
  sourceLanguageLabel: string;
  targetLanguageLabel: string;
}) =>
  [
    `Translate these timed transcript segments from ${sourceLanguageLabel} to ${targetLanguageLabel}.`,
    'Return only one line per segment in this exact format:',
    'id|||translated text',
    'Do not return JSON, bullets, markdown, code fences, or commentary.',
    'Preserve every id exactly. Do not merge, split, reorder, skip, or add segments.',
    'Replace any internal line breaks in translations with spaces.',
    'Keep each translation natural for reading alongside video playback.',
    '',
    JSON.stringify({ segments: items }),
  ].join('\n');

const validateSegmentTranslations = ({
  expectedIds,
  translations,
}: {
  expectedIds: string[];
  translations: SegmentTranslation[];
}) => {
  const expected = new Set(expectedIds);
  const seen = new Set<string>();

  for (const translation of translations) {
    if (!expected.has(translation.id)) {
      throw new Error(`Translation response included unexpected segment ${translation.id}.`);
    }

    if (seen.has(translation.id)) {
      throw new Error(`Translation response duplicated segment ${translation.id}.`);
    }

    seen.add(translation.id);
  }

  const missingId = expectedIds.find((id) => !seen.has(id));

  if (missingId) {
    throw new Error(`Translation response omitted segment ${missingId}.`);
  }

  return translations;
};

const parseLineSegmentTranslations = (text: string) => {
  const translations: SegmentTranslation[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line === '```') {
      continue;
    }

    const separatorIndex = line.indexOf('|||');

    if (separatorIndex === -1) {
      continue;
    }

    const id = line.slice(0, separatorIndex).trim();
    const translatedText = normalizeWhitespace(line.slice(separatorIndex + 3));

    if (!id || !translatedText) {
      throw new Error('Translation response included a malformed segment.');
    }

    translations.push({ id, translatedText });
  }

  return translations;
};

const parseJsonSegmentTranslations = (text: string) => {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Translation response did not contain JSON.');
  }

  const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as {
    segments?: unknown;
  };

  if (!Array.isArray(parsed.segments)) {
    throw new Error('Translation response did not include a segments array.');
  }

  return parsed.segments.map((segment) => {
    if (
      !segment ||
      typeof segment !== 'object' ||
      !('id' in segment) ||
      !('translatedText' in segment)
    ) {
      throw new Error('Translation response included a malformed segment.');
    }

    const id = String(segment.id);
    const translatedText = normalizeWhitespace(String(segment.translatedText));

    if (!translatedText) {
      throw new Error(`Translation response included an empty translation for segment ${id}.`);
    }

    return {
      id,
      translatedText,
    };
  });
};

export const parseSegmentTranslations = ({
  expectedIds,
  text,
}: {
  expectedIds: string[];
  text: string;
}): SegmentTranslation[] => {
  const lineTranslations = parseLineSegmentTranslations(text);

  if (lineTranslations.length > 0) {
    return validateSegmentTranslations({ expectedIds, translations: lineTranslations });
  }

  return validateSegmentTranslations({
    expectedIds,
    translations: parseJsonSegmentTranslations(text),
  });
};

export const applySegmentTranslations = ({
  segments,
  translations,
}: {
  segments: DisplayTranscriptSegment[];
  translations: SegmentTranslation[];
}) => {
  const translationById = new Map(
    translations.map((translation) => [translation.id, translation.translatedText]),
  );

  return segments.map((segment) => ({
    ...segment,
    translatedText: translationById.get(String(segment.index)) ?? segment.translatedText,
  }));
};

export const buildDebugReportText = (report: ProcessingDebugReport) => {
  const lines = [
    `Entry: ${report.entryId}`,
    report.videoTitle ? `Video: ${report.videoTitle}` : null,
    `Status: ${report.status}`,
    report.processingStage ? `Stage: ${report.processingStage}` : null,
    report.durationSec === undefined ? null : `Duration: ${report.durationSec.toFixed(1)}s`,
    `Chunks: ${report.chunkCount}`,
    report.realtimeFactor === undefined
      ? null
      : `Realtime factor: ${report.realtimeFactor.toFixed(2)}x`,
    report.timings?.downloadSec === undefined
      ? null
      : `Download: ${report.timings.downloadSec.toFixed(1)}s`,
    report.timings?.ffmpegSec === undefined
      ? null
      : `FFmpeg: ${report.timings.ffmpegSec.toFixed(1)}s`,
    report.timings?.whisperSec === undefined
      ? null
      : `Whisper: ${report.timings.whisperSec.toFixed(1)}s`,
    report.timings?.translationSec === undefined
      ? null
      : `Translation: ${report.timings.translationSec.toFixed(1)}s`,
    report.timings?.totalSec === undefined
      ? null
      : `Total: ${report.timings.totalSec.toFixed(1)}s`,
    report.retryCount === undefined ? null : `Retries: ${report.retryCount}`,
    report.cloudflareCostUsd === undefined
      ? null
      : `Cloudflare cost: $${report.cloudflareCostUsd.toFixed(6)}`,
    report.openRouterCostUsd === undefined
      ? null
      : `OpenRouter cost: $${report.openRouterCostUsd.toFixed(6)}`,
    report.errorMessage ? `Error: ${report.errorMessage}` : null,
  ];

  return lines.filter(Boolean).join('\n');
};
