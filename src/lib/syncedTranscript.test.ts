import { describe, expect, it } from 'vitest';
import {
  applySegmentTranslations,
  buildDebugReportText,
  buildSegmentTranslationPrompt,
  buildTranslationBatches,
  estimateCloudflareWhisperCost,
  mergeTranscriptSegments,
  parseSegmentTranslations,
  shiftChunkSegments,
  splitDisplaySegmentsForCaptions,
} from './syncedTranscript';

describe('shiftChunkSegments', () => {
  it('shifts chunk-local seconds into absolute milliseconds', () => {
    expect(
      shiftChunkSegments({
        chunkIndex: 2,
        chunkStartMs: 60_000,
        segments: [
          {
            endSec: 4.5,
            startSec: 1.2,
            text: ' Hello   world ',
          },
        ],
      }),
    ).toEqual([
      {
        chunkIndex: 2,
        endMs: 64_500,
        startMs: 61_200,
        text: 'Hello world',
      },
    ]);
  });

  it('drops empty text segments', () => {
    expect(
      shiftChunkSegments({
        chunkIndex: 0,
        chunkStartMs: 0,
        segments: [{ endSec: 1, startSec: 0, text: '   ' }],
      }),
    ).toEqual([]);
  });
});

describe('mergeTranscriptSegments', () => {
  it('merges raw segments into readable timed blocks', () => {
    const segments = mergeTranscriptSegments({
      segments: [
        { chunkIndex: 0, endMs: 4_000, startMs: 0, text: 'First idea starts' },
        { chunkIndex: 0, endMs: 8_500, startMs: 4_000, text: 'and now ends.' },
        { chunkIndex: 1, endMs: 12_000, startMs: 8_500, text: 'Second idea' },
        { chunkIndex: 1, endMs: 17_500, startMs: 12_000, text: 'keeps going.' },
      ],
    });

    expect(segments).toEqual([
      {
        endMs: 8_500,
        index: 0,
        originalText: 'First idea starts and now ends.',
        sourceChunkIndexes: [0],
        startMs: 0,
        translatedText: '',
      },
      {
        endMs: 17_500,
        index: 1,
        originalText: 'Second idea keeps going.',
        sourceChunkIndexes: [1],
        startMs: 8_500,
        translatedText: '',
      },
    ]);
  });

  it('flushes long blocks even without punctuation', () => {
    const segments = mergeTranscriptSegments({
      segments: [
        { chunkIndex: 0, endMs: 7_000, startMs: 0, text: 'One' },
        { chunkIndex: 0, endMs: 14_000, startMs: 7_000, text: 'two' },
        { chunkIndex: 0, endMs: 21_000, startMs: 14_000, text: 'three' },
      ],
    });

    expect(segments).toHaveLength(3);
    expect(segments[0]?.endMs).toBe(7_000);
    expect(segments[0]?.originalText).toBe('One');
  });
});

describe('splitDisplaySegmentsForCaptions', () => {
  it('splits long translated segments into caption-sized chunks', () => {
    const segments = splitDisplaySegmentsForCaptions({
      maxChars: 24,
      segments: [
        {
          endMs: 12_000,
          index: 0,
          originalText: 'Original long line.',
          sourceChunkIndexes: [0],
          startMs: 0,
          translatedText: 'The first short caption should become several readable pieces.',
        },
      ],
    });

    expect(segments).toMatchObject([
      { index: 0, startMs: 0, translatedText: 'The first short caption' },
      { index: 1, startMs: 4_000, translatedText: 'should become several' },
      { index: 2, startMs: 8_000, endMs: 12_000, translatedText: 'readable pieces.' },
    ]);
  });
});

describe('estimateCloudflareWhisperCost', () => {
  it('reports list price and daily free allocation impact', () => {
    const estimate = estimateCloudflareWhisperCost({ audioMinutes: 150 });

    expect(estimate.listPriceUsd).toBeCloseTo(0.0765);
    expect(estimate.billableAudioMinutes).toBe(0);
  });

  it('calculates billable minutes above the daily inclusion', () => {
    const estimate = estimateCloudflareWhisperCost({
      audioMinutes: 250,
      includedDailyAudioMinutes: 200,
    });

    expect(estimate.billableAudioMinutes).toBe(50);
  });
});

describe('translation helpers', () => {
  const segments = [
    {
      endMs: 8_500,
      index: 0,
      originalText: 'Hello world.',
      sourceChunkIndexes: [0],
      startMs: 0,
      translatedText: '',
    },
    {
      endMs: 17_000,
      index: 1,
      originalText: 'This stays aligned.',
      sourceChunkIndexes: [0],
      startMs: 8_500,
      translatedText: '',
    },
  ];

  it('builds translation batches with stable ids', () => {
    expect(buildTranslationBatches({ maxChars: 70, segments })).toEqual([
      [{ id: '0', originalText: 'Hello world.' }],
      [{ id: '1', originalText: 'This stays aligned.' }],
    ]);
  });

  it('builds a line-based translation prompt', () => {
    const prompt = buildSegmentTranslationPrompt({
      items: [{ id: '0', originalText: 'Hello world.' }],
      sourceLanguageLabel: 'English',
      targetLanguageLabel: 'Urdu',
    });

    expect(prompt).toContain('id|||translated text');
    expect(prompt).toContain('Do not return JSON');
    expect(prompt).toContain('Preserve every id exactly');
    expect(prompt).toContain('"id":"0"');
  });

  it('parses and applies line-based segment translations', () => {
    const translations = parseSegmentTranslations({
      expectedIds: ['0', '1'],
      text: ['0|||Salam duniya.', '1|||Yeh aligned rehta hai.'].join('\n'),
    });

    expect(applySegmentTranslations({ segments, translations })).toMatchObject([
      { index: 0, translatedText: 'Salam duniya.' },
      { index: 1, translatedText: 'Yeh aligned rehta hai.' },
    ]);
  });

  it('keeps JSON parsing as a compatibility fallback', () => {
    const translations = parseSegmentTranslations({
      expectedIds: ['0', '1'],
      text: '{"segments":[{"id":"0","translatedText":"Salam duniya."},{"id":"1","translatedText":"Yeh aligned rehta hai."}]}',
    });

    expect(applySegmentTranslations({ segments, translations })).toMatchObject([
      { index: 0, translatedText: 'Salam duniya.' },
      { index: 1, translatedText: 'Yeh aligned rehta hai.' },
    ]);
  });

  it('rejects missing segment ids', () => {
    expect(() =>
      parseSegmentTranslations({
        expectedIds: ['0', '1'],
        text: '{"segments":[{"id":"0","translatedText":"Salam duniya."}]}',
      }),
    ).toThrow('omitted segment 1');
  });
});

describe('buildDebugReportText', () => {
  it('formats a compact copyable report', () => {
    expect(
      buildDebugReportText({
        chunkCount: 12,
        cloudflareCostUsd: 0.0012,
        entryId: 'entry123',
        openRouterCostUsd: 0.0045,
        realtimeFactor: 3.25,
        status: 'ready',
        timings: {
          totalSec: 120,
          whisperSec: 75,
        },
        videoTitle: 'A useful lesson',
      }),
    ).toContain('Realtime factor: 3.25x');
  });
});
