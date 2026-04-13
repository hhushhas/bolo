import type { TranscriptResponse } from 'youtube-transcript';

const YT_INITIAL_PLAYER_RESPONSE = 'var ytInitialPlayerResponse = ';
const watchPageUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );

const parseInlineJson = (html: string, marker = YT_INITIAL_PLAYER_RESPONSE) => {
  const start = html.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const jsonStart = start + marker.length;
  let depth = 0;

  for (let index = jsonStart; index < html.length; index += 1) {
    if (html[index] === '{') {
      depth += 1;
    } else if (html[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
};

export const extractCaptionTrack = (html: string, preferredLanguageCode?: string) => {
  const playerResponse = parseInlineJson(html);
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks as
      | { baseUrl?: string; languageCode?: string }[]
      | undefined;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  const selectedTrack =
    (preferredLanguageCode
      ? tracks.find((track) => track.languageCode === preferredLanguageCode)
      : undefined) ?? tracks[0];

  if (!selectedTrack?.baseUrl || !selectedTrack.languageCode) {
    return null;
  }

  return {
    baseUrl: selectedTrack.baseUrl.replace(/\\u0026/g, '&'),
    languageCode: selectedTrack.languageCode,
  };
};

export const parseCaptionXml = (xml: string, languageCode: string): TranscriptResponse[] => {
  const paragraphMatches = [...xml.matchAll(/<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)];

  if (paragraphMatches.length > 0) {
    return paragraphMatches.flatMap((match) => {
      const segments = [...match[3].matchAll(/<s[^>]*>([^<]*)<\/s>/g)];
      const combined = segments.length > 0
        ? segments.map((segment) => segment[1]).join('')
        : match[3].replace(/<[^>]+>/g, '');
      const text = decodeEntities(combined).trim();

      if (!text) {
        return [];
      }

      return [{
        duration: Number.parseInt(match[2], 10),
        lang: languageCode,
        offset: Number.parseInt(match[1], 10),
        text,
      } satisfies TranscriptResponse];
    });
  }

  return [...xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g)].map((match) => ({
    duration: Number.parseFloat(match[2]),
    lang: languageCode,
    offset: Number.parseFloat(match[1]),
    text: decodeEntities(match[3]).trim(),
  }));
};

export const normalizeTranscriptLines = (lines: TranscriptResponse[]) => {
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

export const fetchTranscriptLinesFromYouTube = async (
  videoId: string,
  preferredLanguageCode?: string,
) => {
  const watchPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': watchPageUserAgent,
    },
  });

  if (!watchPageResponse.ok) {
    throw new Error(`Could not open the YouTube page for ${videoId}.`);
  }

  const html = await watchPageResponse.text();
  const track = extractCaptionTrack(
    html,
    preferredLanguageCode && preferredLanguageCode !== 'auto' ? preferredLanguageCode : undefined,
  );

  if (!track) {
    throw new Error('No transcript track was exposed by YouTube for this video.');
  }

  const transcriptResponse = await fetch(track.baseUrl, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': watchPageUserAgent,
    },
  });

  if (!transcriptResponse.ok) {
    throw new Error('YouTube did not return the caption track for this video.');
  }

  const xml = await transcriptResponse.text();
  const lines = parseCaptionXml(xml, track.languageCode);

  if (lines.length === 0) {
    throw new Error('The caption track was empty for this video.');
  }

  return lines;
};
