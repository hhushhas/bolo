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
  maxDurationMs = 18000,
  minDurationMs = 8000,
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
    'Return strict JSON with exactly this shape:',
    '{"segments":[{"id":"0","translatedText":"..."}]}',
    'Preserve every id exactly. Do not merge, split, reorder, skip, or add segments.',
    'Keep each translation natural for reading alongside video playback.',
    '',
    JSON.stringify({ segments: items }),
  ].join('\n');

export const parseSegmentTranslations = ({
  expectedIds,
  text,
}: {
  expectedIds: string[];
  text: string;
}): SegmentTranslation[] => {
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

  const translations = parsed.segments.map((segment) => {
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
