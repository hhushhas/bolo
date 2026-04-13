const youtubeHostnames = new Set([
  'youtu.be',
  'www.youtu.be',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);

export type YouTubePreview = {
  authorName?: string;
  kind: 'short' | 'video';
  thumbnailUrl: string;
  title: string;
  url: string;
  videoId: string;
};

export const parseYouTubeUrl = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (!youtubeHostnames.has(url.hostname)) {
      return null;
    }

    if (url.hostname.includes('youtu.be')) {
      const videoId = url.pathname.split('/').filter(Boolean)[0];

      if (videoId) {
        return {
          cleanUrl: `https://www.youtube.com/watch?v=${videoId}`,
          kind: 'video',
          videoId,
        } as const;
      }
    }

    const pathname = url.pathname.split('/').filter(Boolean);

    if (pathname[0] === 'watch') {
      const videoId = url.searchParams.get('v');

      if (videoId) {
        return {
          cleanUrl: `https://www.youtube.com/watch?v=${videoId}`,
          kind: 'video',
          videoId,
        } as const;
      }
    }

    if (pathname[0] === 'shorts' || pathname[0] === 'embed' || pathname[0] === 'live') {
      const videoId = pathname[1];

      if (videoId) {
        return {
          cleanUrl: `https://www.youtube.com/watch?v=${videoId}`,
          kind: pathname[0] === 'shorts' ? 'short' : 'video',
          videoId,
        } as const;
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const getYouTubeThumbnailUrl = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

export const fetchYouTubePreview = async (url: string) => {
  const parsed = parseYouTubeUrl(url);

  if (!parsed) {
    throw new Error('Please paste a valid YouTube video or Shorts link.');
  }

  const response = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.cleanUrl)}&format=json`,
  );

  if (!response.ok) {
    throw new Error('We could not load that video preview.');
  }

  const data = await response.json();

  return {
    authorName: data.author_name as string | undefined,
    kind: parsed.kind,
    thumbnailUrl: (data.thumbnail_url as string | undefined) ?? getYouTubeThumbnailUrl(parsed.videoId),
    title: (data.title as string | undefined) ?? 'YouTube video',
    url: parsed.cleanUrl,
    videoId: parsed.videoId,
  } satisfies YouTubePreview;
};

export const buildWhatsAppShareUrl = (text: string) =>
  `https://wa.me/?text=${encodeURIComponent(text)}`;
