import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import YoutubePlayer, {
  PLAYER_STATES,
  type YoutubeIframeRef,
} from 'react-native-youtube-iframe';

export type YouTubeVideoSlotProps = {
  colors: {
    backgroundAccent: string;
    border: string;
    danger: string;
    text: string;
    textSoft: string;
  };
  isPlaying: boolean;
  onDurationChange: (durationMs: number) => void;
  onError: (message: string) => void;
  onPlayingChange: (playing: boolean) => void;
  onTimeChange: (timeMs: number) => void;
  playbackRate: number;
  seekRequestMs: number | null;
  videoId: string;
};

export function YouTubeVideoSlot({
  colors,
  isPlaying,
  onDurationChange,
  onError,
  onPlayingChange,
  onTimeChange,
  playbackRate,
  seekRequestMs,
  videoId,
}: YouTubeVideoSlotProps) {
  const playerRef = useRef<YoutubeIframeRef | null>(null);
  const { height, width } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const landscape = width > height;
  const playerWidth = Math.max(260, landscape ? width * 0.48 : width - 64);
  const playerHeight = Math.max(200, Math.round(playerWidth * 9 / 16));

  useEffect(() => {
    if (!ready || seekRequestMs === null) {
      return;
    }

    playerRef.current?.seekTo(seekRequestMs / 1000, true);
  }, [ready, seekRequestMs]);

  useEffect(() => {
    if (!ready || !isPlaying) {
      return;
    }

    const interval = setInterval(() => {
      void playerRef.current?.getCurrentTime().then((seconds) => {
        onTimeChange(Math.round(seconds * 1000));
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, onTimeChange, ready]);

  return (
    <View style={styles.container}>
      <YoutubePlayer
        height={playerHeight}
        initialPlayerParams={{
          controls: false,
          preventFullScreen: true,
          rel: false,
        }}
        onChangeState={(state: PLAYER_STATES) => {
          if (state === PLAYER_STATES.PLAYING) {
            onPlayingChange(true);
          } else if (state === PLAYER_STATES.PAUSED || state === PLAYER_STATES.ENDED) {
            onPlayingChange(false);
          }
        }}
        onError={(nextError: string) => {
          const message = `YouTube player error: ${nextError}`;
          setError(message);
          onError(message);
        }}
        onReady={() => {
          setReady(true);
          setError(null);
          void playerRef.current?.getDuration().then((seconds) => {
            onDurationChange(Math.round(seconds * 1000));
          });
        }}
        play={isPlaying}
        playbackRate={playbackRate}
        ref={playerRef}
        videoId={videoId}
        webViewStyle={[styles.webView, { backgroundColor: colors.backgroundAccent }]}
        width={playerWidth}
      />
      {!ready || error ? (
        <View
          pointerEvents="none"
          style={[
            styles.statusOverlay,
            {
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.statusText, { color: error ? colors.danger : colors.textSoft }]}>
            {error ?? 'Loading video...'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  statusOverlay: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 2,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '900',
  },
  webView: {
    opacity: 0.99,
  },
});
