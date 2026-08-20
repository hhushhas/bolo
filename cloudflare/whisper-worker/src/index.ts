type WhisperWorkerEnv = {
  BOLO_WORKER_SECRET: string;
  GROQ_API_KEY: string;
  GROQ_MODEL?: string;
  GROQ_UNIT_PRICE_USD?: string;
  MEDIA_BUCKET: {
    delete: (keys: string | string[]) => Promise<void>;
    get: (key: string) => Promise<R2ObjectBody | null>;
    list: (options: { prefix: string }) => Promise<{
      objects: {
        key: string;
        size: number;
      }[];
    }>;
  };
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

type ListMediaRequest = {
  prefix: string;
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

type GroqTranscriptionResponse = {
  segments: WhisperSegment[];
  text?: string;
  transcriptionInfo?: WhisperResponse['transcription_info'];
};

const defaultGroqModel = 'whisper-large-v3-turbo';
const defaultGroqUnitPriceUsd = 0.04 / 60;
const groqTranscriptionUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TIMEOUT_MS = 120_000;

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

const parseListMediaRequest = async (request: Request) => {
  const body = (await request.json()) as Partial<ListMediaRequest>;

  if (typeof body.prefix !== 'string' || !body.prefix || body.prefix.includes('..')) {
    throw new Error('Invalid media prefix.');
  }

  return {
    prefix: body.prefix,
  } satisfies ListMediaRequest;
};

const getObjectProperty = (value: object, key: string) =>
  Object.entries(value).find(([property]) => property === key)?.[1];

const readOptionalNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readOptionalString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const parseGroqResponse = (payload: unknown): GroqTranscriptionResponse => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Groq returned an invalid transcription response.');
  }

  const segmentsValue = getObjectProperty(payload, 'segments');

  if (segmentsValue !== undefined && !Array.isArray(segmentsValue)) {
    throw new Error('Groq returned invalid transcription segments.');
  }

  const segmentValues: unknown[] = Array.isArray(segmentsValue) ? segmentsValue : [];
  const segments = segmentValues.flatMap((segment) => {
    if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) {
      return [];
    }

    return [
      {
        avg_logprob: readOptionalNumber(getObjectProperty(segment, 'avg_logprob')),
        compression_ratio: readOptionalNumber(getObjectProperty(segment, 'compression_ratio')),
        end: readOptionalNumber(getObjectProperty(segment, 'end')),
        no_speech_prob: readOptionalNumber(getObjectProperty(segment, 'no_speech_prob')),
        start: readOptionalNumber(getObjectProperty(segment, 'start')),
        text: readOptionalString(getObjectProperty(segment, 'text')),
      },
    ];
  });
  const duration = readOptionalNumber(getObjectProperty(payload, 'duration'));
  const language = readOptionalString(getObjectProperty(payload, 'language'));

  return {
    segments,
    text: readOptionalString(getObjectProperty(payload, 'text')),
    transcriptionInfo:
      duration === undefined && language === undefined ? undefined : { duration, language },
  };
};

const transcribeWithGroq = async ({
  apiKey,
  audio,
  initialPrompt,
  language,
  model,
}: {
  apiKey: string;
  audio: ArrayBuffer;
  initialPrompt?: string;
  language?: string;
  model: string;
}) => {
  if (!apiKey) {
    throw new Error('Missing GROQ_API_KEY.');
  }

  const formData = new FormData();
  formData.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'chunk.mp3');
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  formData.append('temperature', '0');

  if (initialPrompt) {
    formData.append('prompt', initialPrompt);
  }

  if (language) {
    formData.append('language', language);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(groqTranscriptionUrl, {
      body: formData,
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      method: 'POST',
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Groq transcription timed out after ${GROQ_TIMEOUT_MS / 1000}s.`);
    }

    throw new Error(
      `Groq transcription request failed: ${error instanceof Error ? error.message : String(error)}.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();

  if (!response.ok) {
    const details = responseText.slice(0, 500).replace(/\s+/g, ' ').trim();
    throw new Error(`Groq transcription failed with HTTP ${response.status}${details ? `: ${details}` : '.'}`);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error('Groq returned a non-JSON transcription response.');
  }

  return parseGroqResponse(payload);
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

    if (pathname === '/list-media') {
      try {
        const payload = await parseListMediaRequest(request);
        const result = await env.MEDIA_BUCKET.list({ prefix: payload.prefix });

        return jsonResponse({
          objects: result.objects.map((object) => ({
            key: object.key,
            size: object.size,
          })),
        });
      } catch (error) {
        return jsonResponse(
          { error: error instanceof Error ? error.message : 'Media listing failed.' },
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

    const model = env.GROQ_MODEL ?? defaultGroqModel;
    const unitPriceUsd = Number.parseFloat(
      env.GROQ_UNIT_PRICE_USD ?? String(defaultGroqUnitPriceUsd),
    );
    const audioMinutes = payload.chunkDurationMs / 60_000;

    try {
      if (!Number.isFinite(unitPriceUsd) || unitPriceUsd <= 0) {
        throw new Error('Invalid GROQ_UNIT_PRICE_USD configuration.');
      }

      const groqResponse = await transcribeWithGroq({
        apiKey: env.GROQ_API_KEY,
        audio: await chunk.arrayBuffer(),
        initialPrompt: payload.initialPrompt,
        language: payload.language,
        model,
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
          segments: groqResponse.segments,
        }),
        text: groqResponse.text,
        transcriptionInfo: groqResponse.transcriptionInfo,
        unitPriceUsd,
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
