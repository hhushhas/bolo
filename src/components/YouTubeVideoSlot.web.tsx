import { createElement, useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { YouTubeVideoSlotProps } from './YouTubeVideoSlot';

export function YouTubeVideoSlot({
  colors,
  isPlaying,
  onDurationChange,
  onPlayingChange,
  seekRequestMs,
  videoId,
}: YouTubeVideoSlotProps) {
  const { height, width } = useWindowDimensions();
  const landscape = width > height;
  const playerWidth = Math.max(260, landscape ? width * 0.48 : width - 64);
  const playerHeight = Math.max(200, Math.round((playerWidth * 9) / 16));
  const startSeconds = seekRequestMs === null ? 0 : Math.max(0, Math.floor(seekRequestMs / 1000));
  const src = useMemo(() => {
    const params = new URLSearchParams({
      autoplay: isPlaying ? '1' : '0',
      controls: '0',
      modestbranding: '1',
      rel: '0',
      start: String(startSeconds),
    });

    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }, [isPlaying, startSeconds, videoId]);

  useEffect(() => {
    onDurationChange(0);
  }, [onDurationChange]);

  useEffect(() => {
    onPlayingChange(isPlaying);
  }, [isPlaying, onPlayingChange]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.backgroundAccent,
          borderColor: colors.border,
          height: playerHeight,
          width: playerWidth,
        },
      ]}
    >
      {createElement('iframe', {
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
        allowFullScreen: true,
        src,
        style: {
          border: 0,
          height: '100%',
          width: '100%',
        },
        title: 'YouTube video player',
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 2,
    overflow: 'hidden',
  },
});
