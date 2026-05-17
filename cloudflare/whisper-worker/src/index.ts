type WhisperWorkerEnv = {
  AI: {
    run: (model: string, input: Record<string, unknown>) => Promise<WhisperResponse>;
  };
  BOLO_WORKER_SECRET: string;
  MEDIA_BUCKET: {
    delete: (keys: string | string[]) => Promise<void>;
    get: (key: string) => Promise<R2ObjectBody | null>;
  };
  WHISPER_MODEL?: string;
  WHISPER_UNIT_PRICE_USD?: string;
};

type R2ObjectBody = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  size?: number;
};

type TranscribeChunkRequest = {
  chunkDurationMs: number;
  chunkIndex: number;
  chunkStartMs: number;
  entryId: string;
  initialPrompt?: string;
  language?: string;
  r2Key: string;
};

type CleanupChunksRequest = {
  entryId: string;
  r2Keys: string[];
};

type WhisperSegment = {
  avg_logprob?: number;
  compression_ratio?: number;
  end?: number;
  endMs?: number;
  endSec?: number;
  no_speech_prob?: number;
  start?: number;
  startMs?: number;
  startSec?: number;
  text?: string;
};

type WhisperResponse = {
  segments?: WhisperSegment[];
  text?: string;
  transcription_info?: {
    duration?: number;
    language?: string;
    word_count?: number;
  };
  vtt?: string;
};

const defaultWhisperModel = '@cf/openai/whisper-large-v3-turbo';
const defaultWhisperUnitPriceUsd = 0.00051;

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    headers: {
      'cache-control': 'no-store',
      ...init?.headers,
    },
    status: init?.status,
  });

const requireAuth = (request: Request, env: WhisperWorkerEnv) => {
  const authorization = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.BOLO_WORKER_SECRET}`;

  return Boolean(env.BOLO_WORKER_SECRET) && authorization === expected;
};

const parseRequest = async (request: Request) => {
  const body = (await request.json()) as Partial<TranscribeChunkRequest>;

  if (
    typeof body.entryId !== 'string' ||
    typeof body.r2Key !== 'string' ||
    typeof body.chunkIndex !== 'number' ||
    typeof body.chunkStartMs !== 'number' ||
    typeof body.chunkDurationMs !== 'number'
  ) {
    throw new Error('Invalid transcribe chunk request.');
  }

  return {
    chunkDurationMs: body.chunkDurationMs,
    chunkIndex: body.chunkIndex,
    chunkStartMs: body.chunkStartMs,
    entryId: body.entryId,
    initialPrompt: body.initialPrompt,
    language: body.language,
    r2Key: body.r2Key,
  } satisfies TranscribeChunkRequest;
};

const parseCleanupRequest = async (request: Request) => {
  const body = (await request.json()) as Partial<CleanupChunksRequest>;

  if (
    typeof body.entryId !== 'string' ||
    !Array.isArray(body.r2Keys) ||
    body.r2Keys.length === 0 ||
    body.r2Keys.some((key) => typeof key !== 'string' || !key)
  ) {
    throw new Error('Invalid cleanup request.');
  }

  return {
    entryId: body.entryId,
    r2Keys: body.r2Keys,
  } satisfies CleanupChunksRequest;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
};

const normalizeWhisperSegments = ({
  chunkStartMs,
  segments,
}: {
  chunkStartMs: number;
  segments: WhisperSegment[];
}) =>
  segments.flatMap((segment, index) => {
    const text = segment.text?.replace(/\s+/g, ' ').trim();

    if (!text) {
      return [];
    }

    const localStartMs =
      segment.startMs ??
      (segment.startSec === undefined ? undefined : Math.round(segment.startSec * 1000));
    const localEndMs =
      segment.endMs ??
      (segment.endSec === undefined ? undefined : Math.round(segment.endSec * 1000));
    const fallbackStartMs =
      typeof segment.start === 'number' ? Math.round(segment.start * 1000) : 0;
    const fallbackEndMs =
      typeof segment.end === 'number' ? Math.round(segment.end * 1000) : fallbackStartMs;

    return [
      {
        avgLogprob: segment.avg_logprob,
        compressionRatio: segment.compression_ratio,
        endMs: chunkStartMs + (localEndMs ?? fallbackEndMs),
        index,
        noSpeechProbability: segment.no_speech_prob,
        startMs: chunkStartMs + (localStartMs ?? fallbackStartMs),
        text,
      },
    ];
  });

const handler = {
  async fetch(request: Request, env: WhisperWorkerEnv): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed.' }, { status: 405 });
    }

    if (!requireAuth(request, env)) {
      return jsonResponse({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { pathname } = new URL(request.url);

    if (pathname === '/cleanup') {
      try {
        const payload = await parseCleanupRequest(request);
        await env.MEDIA_BUCKET.delete(payload.r2Keys);

        return jsonResponse({
          deletedCount: payload.r2Keys.length,
          entryId: payload.entryId,
        });
      } catch (error) {
        return jsonResponse(
          { error: error instanceof Error ? error.message : 'Cleanup failed.' },
          { status: 400 },
        );
      }
    }

    let payload: TranscribeChunkRequest;

    try {
      payload = await parseRequest(request);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'Invalid request.' },
        { status: 400 },
      );
    }

    const chunk = await env.MEDIA_BUCKET.get(payload.r2Key);

    if (!chunk) {
      return jsonResponse({ error: 'Audio chunk not found.' }, { status: 404 });
    }

    const model = env.WHISPER_MODEL ?? defaultWhisperModel;
    const unitPriceUsd = Number.parseFloat(
      env.WHISPER_UNIT_PRICE_USD ?? String(defaultWhisperUnitPriceUsd),
    );
    const audioMinutes = payload.chunkDurationMs / 60_000;

    try {
      const audio = arrayBufferToBase64(await chunk.arrayBuffer());
      const whisperResponse = await env.AI.run(model, {
        audio,
        condition_on_previous_text: false,
        initial_prompt: payload.initialPrompt,
        language: payload.language,
        task: 'transcribe',
        vad_filter: true,
      });

      return jsonResponse({
        audioMinutes,
        chunkIndex: payload.chunkIndex,
        chunkStartMs: payload.chunkStartMs,
        estimatedCostUsd: audioMinutes * unitPriceUsd,
        entryId: payload.entryId,
        model,
        segments: normalizeWhisperSegments({
          chunkStartMs: payload.chunkStartMs,
          segments: whisperResponse.segments ?? [],
        }),
        text: whisperResponse.text,
        transcriptionInfo: whisperResponse.transcription_info,
        unitPriceUsd,
        vtt: whisperResponse.vtt,
      });
    } catch (error) {
      return jsonResponse(
        {
          chunkIndex: payload.chunkIndex,
          entryId: payload.entryId,
          error: error instanceof Error ? error.message : 'Whisper transcription failed.',
        },
        { status: 502 },
      );
    }
  },
};

export default handler;
