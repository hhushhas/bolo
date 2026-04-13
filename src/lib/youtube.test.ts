import { describe, expect, it } from 'vitest';
import { buildWhatsAppShareUrl, parseYouTubeUrl } from './youtube';

describe('parseYouTubeUrl', () => {
  it('handles standard watch URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=abc123xyz99')).toMatchObject({
      cleanUrl: 'https://www.youtube.com/watch?v=abc123xyz99',
      kind: 'video',
      videoId: 'abc123xyz99',
    });
  });

  it('handles shorts URLs', () => {
    expect(parseYouTubeUrl('https://youtube.com/shorts/abc123xyz99?feature=share')).toMatchObject({
      cleanUrl: 'https://www.youtube.com/watch?v=abc123xyz99',
      kind: 'short',
      videoId: 'abc123xyz99',
    });
  });

  it('rejects non-youtube links', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=nope')).toBeNull();
  });
});

describe('buildWhatsAppShareUrl', () => {
  it('encodes the message for a wa.me link', () => {
    expect(buildWhatsAppShareUrl('hello world')).toBe('https://wa.me/?text=hello%20world');
  });
});
