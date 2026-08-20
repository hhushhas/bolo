import { Container, getContainer } from '@cloudflare/containers';
export { ContainerProxy } from '@cloudflare/containers';

type R2Bucket = {
  put: (key: string, value: BodyInit | null, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
};

type MediaPrepEnv = {
  BOLO_CONTAINER_SECRET?: string;
  CHUNK_SECONDS?: string;
  MAX_VIDEO_SECONDS?: string;
  MEDIA_BUCKET: R2Bucket;
  MEDIA_PREP: unknown;
  YOUTUBE_COOKIES_B64?: string;
};

export class MediaPrepContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = 'container/health';
  sleepAfter = '5s';
  enableInternet = true;
  envVars = (() => {
    const env = (this as unknown as { env: MediaPrepEnv }).env;

    return {
      BOLO_CONTAINER_SECRET: env.BOLO_CONTAINER_SECRET,
      CHUNK_SECONDS: env.CHUNK_SECONDS ?? '45',
      MAX_VIDEO_SECONDS: env.MAX_VIDEO_SECONDS ?? '7200',
      R2_OUTBOUND_BASE_URL: 'http://example.com',
      YOUTUBE_COOKIES_B64: env.YOUTUBE_COOKIES_B64 ?? '',
    };
  })();

  override onStart() {
    console.log('media prep container started');
  }

  override onStop(params: unknown) {
    console.log('media prep container stopped', JSON.stringify(params));
  }

  override onError(error: unknown) {
    console.error('media prep container error', error);
    throw error;
  }

  override async onActivityExpired() {
    console.log('media prep container activity expired, destroying instance');
    await this.destroy();
  }
}

MediaPrepContainer.outboundByHost = {
  'example.com': async (request: Request, env: MediaPrepEnv) => {
    if (request.method !== 'PUT') {
      return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    if (!key || key.includes('..')) {
      return Response.json({ error: 'Invalid R2 key.' }, { status: 400 });
    }

    await env.MEDIA_BUCKET.put(key, await request.arrayBuffer(), {
      httpMetadata: {
        contentType: request.headers.get('content-type') ?? 'audio/mpeg',
      },
    });

    return Response.json({ key, ok: true });
  },
};

const youtubeHostnames = new Set([
  'youtu.be',
  'www.youtu.be',
  'music.youtube.com',
  'youtube.com',
  'youtube-nocookie.com',
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'm.youtube.com',
]);

const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const uuidPattern = /^[0-9a-f-]{36}$/i;

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    headers: {
      'cache-control': 'no-store',
      ...init?.headers,
    },
    status: init?.status,
  });

const authError = (request: Request, env: MediaPrepEnv) => {
  if (!env.BOLO_CONTAINER_SECRET) {
    return jsonResponse({ error: 'Container secret is not configured.' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${env.BOLO_CONTAINER_SECRET}`) {
    return jsonResponse({ error: 'Unauthorized.' }, { status: 401 });
  }

  return null;
};

const normalizeVideoId = (value: string | null | undefined) => {
  const videoId = value?.trim();

  return videoId && youtubeVideoIdPattern.test(videoId) ? videoId : null;
};

const normalizeYouTubeUrl = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);

    if (!youtubeHostnames.has(url.hostname)) {
      return null;
    }

    if (url.hostname.includes('youtu.be')) {
      const videoId = normalizeVideoId(url.pathname.split('/').filter(Boolean)[0]);
      return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
    }

    const pathname = url.pathname.split('/').filter(Boolean);
    const videoId =
      pathname[0] === 'watch'
        ? normalizeVideoId(url.searchParams.get('v'))
        : ['shorts', 'embed', 'live', 'v'].includes(pathname[0])
          ? normalizeVideoId(pathname[1])
          : null;

    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  } catch {
    return null;
  }
};

export default {
  async fetch(request: Request, env: MediaPrepEnv): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      return jsonResponse({ ok: true });
    }

    if (pathname === '/container-health') {
      return jsonResponse({ ok: true, containerStarted: false });
    }

    if (request.method === 'POST' && pathname === '/admin/destroy') {
      const error = authError(request, env);
      if (error) return error;

      const payload = (await request.json().catch(() => null)) as { name?: unknown } | null;
      const name = typeof payload?.name === 'string' ? payload.name : '';

      if (!uuidPattern.test(name)) {
        return jsonResponse({ error: 'Valid container name is required.' }, { status: 400 });
      }

      const container = getContainer(env.MEDIA_PREP as never, name);
      await container.destroy();

      return jsonResponse({ ok: true, name });
    }

    if (request.method !== 'POST' || pathname !== '/prepare') {
      return jsonResponse({ error: 'Not found.' }, { status: 404 });
    }

    const error = authError(request, env);
    if (error) return error;

    const payload = (await request.json().catch(() => null)) as {
      chunkSeconds?: unknown;
      entryId?: unknown;
      jobId?: unknown;
      youtubeUrl?: unknown;
    } | null;

    if (!payload) {
      return jsonResponse({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (typeof payload.entryId !== 'string' || !payload.entryId) {
      return jsonResponse({ error: 'entryId is required.' }, { status: 400 });
    }

    if (payload.chunkSeconds !== undefined) {
      const chunkSeconds = payload.chunkSeconds;

      if (typeof chunkSeconds !== 'number' || !Number.isInteger(chunkSeconds) || chunkSeconds < 15 || chunkSeconds > 90) {
        return jsonResponse({ error: 'chunkSeconds must be between 15 and 90.' }, { status: 400 });
      }
    }

    const youtubeUrl = normalizeYouTubeUrl(payload.youtubeUrl);
    if (!youtubeUrl) {
      return jsonResponse({ error: 'Please send a valid YouTube video or Shorts link.' }, { status: 400 });
    }

    const jobId = typeof payload.jobId === 'string' && uuidPattern.test(payload.jobId)
      ? payload.jobId
      : crypto.randomUUID();
    const containerPayload = {
      ...payload,
      jobId,
      youtubeUrl,
    };
    const container = getContainer(env.MEDIA_PREP as never, jobId);

    try {
      await container.startAndWaitForPorts(8080);

      return await container.containerFetch(
        'http://container/prepare',
        {
          body: JSON.stringify(containerPayload),
          headers: {
            authorization: request.headers.get('authorization') ?? '',
            'content-type': 'application/json',
          },
          method: 'POST',
        },
        8080,
      );
    } catch (error) {
      console.error('media prep wrapper failed', error);

      return jsonResponse(
        {
          details: error instanceof Error ? error.stack : String(error),
          error: 'Media prep container wrapper failed.',
        },
        { status: 502 },
      );
    }
  },
};
