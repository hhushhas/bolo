import { describe, expect, it } from 'vitest';
import {
  buildFallbackChapters,
  buildFallbackSummary,
  formatShareText,
  getFriendlyFailureCopy,
} from './reader';

describe('formatShareText', () => {
  it('builds a simple share block', () => {
    expect(
      formatShareText({
        content: 'Hello world',
        title: 'My Video',
        viewLabel: 'Translation • Urdu',
      }),
    ).toBe('My Video\nTranslation • Urdu\n\nHello world');
  });
});

describe('reader fallbacks', () => {
  it('creates a summary from the first paragraphs', () => {
    const summary = buildFallbackSummary('One.\n\nTwo.\n\nThree.');

    expect(summary).toContain('One.');
  });

  it('creates chapter notes for long text', () => {
    const chapters = buildFallbackChapters(
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nFourth paragraph.',
    );

    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0]?.title).toBeTruthy();
  });
});

describe('getFriendlyFailureCopy', () => {
  it('softens caption-disabled errors', () => {
    expect(getFriendlyFailureCopy('Transcript is disabled on this video').title).toBe(
      'This video does not have readable captions',
    );
  });
});
