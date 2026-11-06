import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useClipPreview } from "./useClipPreview";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("starts at the requested timestamp and stops exactly at the range end", async () => {
  vi.useFakeTimers();
  const video = createRef<HTMLVideoElement>();
  video.current = document.createElement("video");
  const pause = vi.spyOn(video.current, "pause");
  const { result, unmount } = renderHook(() =>
    useClipPreview(video, "project-a"),
  );
  await act(() => result.current.preview(10, 12));
  expect(video.current.currentTime).toBe(10);
  expect(result.current.range).toEqual({ start: 10, end: 12 });
  act(() => {
    video.current!.currentTime = 12.08;
    vi.advanceTimersByTime(50);
  });
  expect(video.current.currentTime).toBe(12);
  expect(result.current.range).toBeNull();
  expect(pause).toHaveBeenCalledTimes(2);
  unmount();
});
