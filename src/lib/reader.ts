export type ReaderChapter = {
  summary: string;
  title: string;
};

export const languagePresets = [
  { code: 'en', flag: '🇺🇸', label: 'English' },
  { code: 'ur', flag: '🇵🇰', label: 'Urdu' },
  { code: 'ar', flag: '🇸🇦', label: 'Arabic' },
  { code: 'es', flag: '🇪🇸', label: 'Spanish' },
] as const;

export const formatShareText = ({
  content,
  title,
  viewLabel,
}: {
  content: string;
  title: string;
  viewLabel: string;
}) =>
  [
    title,
    viewLabel,
    '',
    content,
  ].join('\n');

export const splitIntoParagraphs = (text: string) =>
  text
    .split('\n\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const trimSentence = (text: string, maxLength = 180) =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}...`;

export const buildFallbackSummary = (text: string) => {
  const paragraphs = splitIntoParagraphs(text).slice(0, 3);

  if (paragraphs.length === 0) {
    return 'No summary was available yet.';
  }

  return trimSentence(paragraphs.join(' '), 420);
};

export const buildFallbackChapters = (text: string): ReaderChapter[] => {
  const paragraphs = splitIntoParagraphs(text);

  if (paragraphs.length === 0) {
    return [
      {
        summary: 'No chapter notes were available yet.',
        title: 'Quick note',
      },
    ];
  }

  const targetCount = Math.min(4, Math.max(2, Math.ceil(paragraphs.length / 3)));
  const chunkSize = Math.max(1, Math.ceil(paragraphs.length / targetCount));
  const chapters: ReaderChapter[] = [];

  for (let index = 0; index < paragraphs.length; index += chunkSize) {
    const chunk = paragraphs.slice(index, index + chunkSize);
    const opening = chunk[0] ?? '';

    chapters.push({
      summary: trimSentence(chunk.join(' '), 260),
      title: trimSentence(opening.split(/[.!?]/)[0] || `Part ${chapters.length + 1}`, 70),
    });
  }

  return chapters;
};

export const extractJsonObject = (text: string) => {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    return null;
  }
};

export const getFriendlyFailureCopy = (errorMessage?: string) => {
  if (!errorMessage) {
    return {
      body: 'We could not turn this video into text this time.',
      hint: 'Please try another video, or try this one again in a little while.',
      title: 'We could not read this video yet',
    };
  }

  const normalized = errorMessage.toLowerCase();

  if (
    normalized.includes('transcript is disabled') ||
    normalized.includes('no transcript track was exposed') ||
    normalized.includes('no transcripts are available')
  ) {
    return {
      body: 'This YouTube video does not seem to offer captions we can read.',
      hint: 'Please try a different video, or use a version of this video that has captions turned on.',
      title: 'This video does not have readable captions',
    };
  }

  if (normalized.includes('valid youtube video or shorts link')) {
    return {
      body: 'The link does not look like a full YouTube video link.',
      hint: 'Please go back, copy the full link from YouTube, and paste it again.',
      title: 'The link needs another look',
    };
  }

  if (normalized.includes('video is no longer available')) {
    return {
      body: 'This video is not available to open right now.',
      hint: 'Please try another video, or come back later if the video becomes available again.',
      title: 'This video is not available right now',
    };
  }

  if (normalized.includes('too many requests') || normalized.includes('captcha')) {
    return {
      body: 'YouTube is asking us to slow down for a moment.',
      hint: 'Please wait a little and try again soon.',
      title: 'YouTube is busy right now',
    };
  }

  return {
    body: 'Something went wrong while we were reading this video.',
    hint: 'Please try again, or choose another video if this one keeps failing.',
    title: 'We hit a small problem',
  };
};
