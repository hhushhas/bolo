import { createElement, useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { YouTubeVideoSlotProps } from './YouTubeVideoSlot';

export function YouTubeVideoSlot({
  colors,
  onDurationChange,
  seekRequestMs,
  videoId,
}: YouTubeVideoSlotProps) {
  const { height, width } = useWindowDimensions();
  const landscape = width > height;
  const playerWidth = Math.round(landscape ? width * 0.54 : width);
  const playerHeight = Math.round((playerWidth * 9) / 16);
  const startSeconds = seekRequestMs === null ? 0 : Math.max(0, Math.floor(seekRequestMs / 1000));
  const src = useMemo(() => {
    const params = new URLSearchParams({
      controls: '1',
      modestbranding: '1',
      rel: '0',
      start: String(startSeconds),
    });

    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }, [startSeconds, videoId]);

  useEffect(() => {
    onDurationChange(0);
  }, [onDurationChange]);

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
    overflow: 'hidden',
  },
});
