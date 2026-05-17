import { Container, getContainer } from '@cloudflare/containers';
export { ContainerProxy } from '@cloudflare/containers';

type R2Bucket = {
  put: (key: string, value: BodyInit | null, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
};

type MediaPrepEnv = {
  BOLO_CONTAINER_SECRET: string;
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

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    headers: {
      'cache-control': 'no-store',
      ...init?.headers,
    },
    status: init?.status,
  });

export default {
  async fetch(request: Request, env: MediaPrepEnv): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      return jsonResponse({ ok: true });
    }

    if (pathname === '/container-health') {
      const container = getContainer(env.MEDIA_PREP as never, 'health-check');
      await container.startAndWaitForPorts(8080);

      return container.containerFetch('http://container/health', undefined, 8080);
    }

    if (request.method !== 'POST' || pathname !== '/prepare') {
      return jsonResponse({ error: 'Not found.' }, { status: 404 });
    }

    const payload = (await request.json().catch(() => null)) as { jobId?: unknown } | null;

    if (!payload) {
      return jsonResponse({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const jobId = typeof payload?.jobId === 'string' && payload.jobId ? payload.jobId : crypto.randomUUID();
    const container = getContainer(env.MEDIA_PREP as never, jobId);

    try {
      await container.startAndWaitForPorts(8080);

      return await container.containerFetch(
        'http://container/prepare',
        {
          body: JSON.stringify(payload),
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
