declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  import type { TranscriptConfig, TranscriptResponse } from 'youtube-transcript';

  export function fetchTranscript(
    videoId: string,
    config?: TranscriptConfig,
  ): Promise<TranscriptResponse[]>;
}
