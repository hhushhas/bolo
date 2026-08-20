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

  it('handles youtu.be sharing URLs', () => {
    expect(parseYouTubeUrl('https://youtu.be/abc123xyz99?si=share-token')).toMatchObject({
      cleanUrl: 'https://www.youtube.com/watch?v=abc123xyz99',
      kind: 'video',
      videoId: 'abc123xyz99',
    });
  });

  it('rejects malformed IDs made from pasted-together links', () => {
    expect(
      parseYouTubeUrl(
        'https://www.youtube.com/watch?v=Hhttps://youtu.be/H01Kj_X2QKw?si=oNTyK3IR5daNWcJM01',
      ),
    ).toBeNull();
  });

  it('rejects invalid youtu.be IDs', () => {
    expect(parseYouTubeUrl('https://youtu.be/not-a-real-youtube-id')).toBeNull();
  });

  it('rejects non-youtube links', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=nope')).toBeNull();
  });

  it('accepts music.youtube.com links', () => {
    expect(parseYouTubeUrl('https://music.youtube.com/watch?v=abc123xyz99&list=RDAMVM')).toMatchObject({
      cleanUrl: 'https://www.youtube.com/watch?v=abc123xyz99',
      kind: 'video',
      videoId: 'abc123xyz99',
    });
  });
});

describe('buildWhatsAppShareUrl', () => {
  it('encodes the message for a wa.me link', () => {
    expect(buildWhatsAppShareUrl('hello world')).toBe('https://wa.me/?text=hello%20world');
  });
});
