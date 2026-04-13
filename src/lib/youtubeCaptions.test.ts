import { describe, expect, it } from 'vitest';
import { extractCaptionTrack, parseCaptionXml } from './youtubeCaptions';

describe('extractCaptionTrack', () => {
  it('reads the caption track from ytInitialPlayerResponse HTML', () => {
    const html = `
      <html>
        <script>
          var ytInitialPlayerResponse = {
            "captions": {
              "playerCaptionsTracklistRenderer": {
                "captionTracks": [
                  {
                    "baseUrl": "https://www.youtube.com/api/timedtext?v=abc123xyz99\\u0026lang=en",
                    "languageCode": "en"
                  }
                ]
              }
            }
          };
        </script>
      </html>
    `;

    expect(extractCaptionTrack(html)).toEqual({
      baseUrl: 'https://www.youtube.com/api/timedtext?v=abc123xyz99&lang=en',
      languageCode: 'en',
    });
  });
});

describe('parseCaptionXml', () => {
  it('parses paragraph caption XML with nested segments', () => {
    const xml = '<transcript><p t="1200" d="3400"><s>Hello </s><s>world</s></p></transcript>';

    expect(parseCaptionXml(xml, 'en')).toEqual([
      {
        duration: 3400,
        lang: 'en',
        offset: 1200,
        text: 'Hello world',
      },
    ]);
  });
});
