import { RefObject, useCallback, useEffect, useRef, useState } from "react";

export function useClipPreview(
  video: RefObject<HTMLVideoElement | null>,
  projectId?: string,
) {
  const [range, setRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const active = useRef<{ start: number; end: number } | null>(null);

  const stop = useCallback(() => {
    active.current = null;
    video.current?.pause();
    setRange(null);
  }, [video]);

  const preview = useCallback(async (start: number, end: number) => {
    const player = video.current;
    if (
      !player ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    )
      return;
    player.pause();
    player.currentTime = start;
    active.current = { start, end };
    setRange({ start, end });
    try {
      await player.play();
    } catch {
      stop();
      throw new Error(
        "Playback could not start. Check the video's browser codec support and try again.",
      );
    }
  }, [video, stop]);

  useEffect(() => {
    active.current = null;
    setRange(null);
    const player = video.current;
    if (!player) return;
    const check = () => {
      const target = active.current;
      if (!target) return;
      if (player.currentTime >= target.end) {
        active.current = null;
        player.pause();
        player.currentTime = target.end;
        setRange(null);
      } else if (!player.seeking && player.currentTime < target.start - 0.25) {
        active.current = null;
        setRange(null);
      }
    };
    const ended = () => {
      active.current = null;
      setRange(null);
    };
    const timer = setInterval(check, 50);
    player.addEventListener("timeupdate", check);
    player.addEventListener("ended", ended);
    return () => {
      clearInterval(timer);
      player.removeEventListener("timeupdate", check);
      player.removeEventListener("ended", ended);
      active.current = null;
      player.pause();
    };
  }, [projectId, video]);

  return { range, preview, stop };
}
