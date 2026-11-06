import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { timestamp, validateFile } from "./api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("workspace", () => {
  it("stops processing controls when polling reports completion", async () => {
    let completed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ok:true, json:async () =>
      url.endsWith('/health') ? {status:'ready', checks:{}, max_upload_bytes:10000} :
      url.endsWith('/transcript') ? {language:'en',device:'cuda',segments:[{id:0,start:0,end:1,text:'Finished speech.',words:[]}]} :
      url.endsWith('/discovery') ? {status:'idle',clips:[]} :
      [{id:'progress',filename:'progress.mp4',status:completed?'completed':'transcribing',metadata:{duration:10},processing:{started_at:Date.now()/1000,device:'cuda',model:'base',compute_type:'float16',processed_seconds:3,total_seconds:10}}]
    })));
    render(<App />);
    fireEvent.click(await screen.findByRole('button',{name:/^progress.mp4/}));
    expect(screen.getByRole('button',{name:'Cancel processing'})).toBeInTheDocument();
    completed = true;
    await waitFor(() => expect(screen.queryByRole('button',{name:'Cancel processing'})).not.toBeInTheDocument(), {timeout:3000});
    expect(await screen.findByText('Finished speech.')).toBeInTheDocument();
  });
  it("validates MP4 files and size before upload", () => {
    expect(validateFile(new File(["a"], "a.mov"), 10)).toContain("MP4");
    expect(validateFile(new File([], "empty.mp4"), 10)).toContain("empty");
    expect(validateFile(new File(["abc"], "big.mp4"), 2)).toContain("limit");
    expect(validateFile(new File(["abc"], "valid.MP4"), 10)).toBeNull();
    expect(timestamp(3661.9)).toBe("01:01:01");
  });
  it("shows a real disconnected state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);
    expect(screen.getByText("Engine disconnected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import video" })).toBeDisabled();
  });
  it("reopens a saved project, searches and seeks the video", async () => {
    const project = {
      id: "saved",
      filename: "interview.mp4",
      size: 1024,
      status: "completed",
      warning: "GPU transcription failed. Using CPU fallback.",
      metadata: { duration: 120, width: 1920, height: 1080 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.endsWith("/health")
            ? {
                status: "ready",
                checks: { ffmpeg: true, ffprobe: true, model: true },
                max_upload_bytes: 10000,
              }
            : url.endsWith("/transcript")
              ? {
                  language: "en",
                  device: "cpu",
                  segments: [
                    {
                      id: 1,
                      start: 15,
                      end: 20,
                      text: "An interesting moment.",
                      words: [],
                    },
                  ],
                }
              : url.endsWith("/discovery")
                ? { status: "idle", clips: [] }
                : [project],
      })),
    );
    const { container } = render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /^interview.mp4/ }),
    );
    const segment = await screen.findByRole("button", {
      name: /Seek to 00:00:15/,
    });
    fireEvent.click(segment);
    expect(screen.getAllByText("GPU transcription failed. Using CPU fallback.")).toHaveLength(1);
    expect(container.querySelector("video")?.currentTime).toBe(15);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search transcript" }),
      { target: { value: "missing" } },
    );
    await waitFor(() =>
      expect(screen.getByText("No matching segments.")).toBeInTheDocument(),
    );
  });
});

it("confirms permanent deletion, disables repeated requests, and removes the project without reload", async () => {
  let complete!: (value: unknown) => void;
  const project = {
    id: "delete-me",
    filename: "garbage.mp4",
    status: "failed",
    metadata: null,
  };
  const request = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "DELETE")
      return new Promise((resolve) => {
        complete = resolve;
      });
    return Promise.resolve({
      ok: true,
      json: async () =>
        url.endsWith("/health") ? { checks: {}, status: "ready" } : [project],
    });
  });
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete project: garbage.mp4" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("cannot be undone");
  expect(
    request.mock.calls.some(([, options]) => options?.method === "DELETE"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Delete project: garbage.mp4" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  complete({ ok: true, json: async () => ({ deleted: true }) });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Deleted garbage.mp4",
  );
  expect(
    screen.queryByRole("button", { name: "Delete project: garbage.mp4" }),
  ).not.toBeInTheDocument();
  expect(
    request.mock.calls.filter(([, options]) => options?.method === "DELETE"),
  ).toHaveLength(1);
});

it("keeps the project and displays deletion failures", async () => {
  const project = {
    id: "busy",
    filename: "busy.mp4",
    status: "completed",
    metadata: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => ({
      ok: options?.method !== "DELETE",
      json: async () =>
        options?.method === "DELETE"
          ? {
              detail:
                "This project is processing. Wait for discovery to finish.",
            }
          : url.endsWith("/health")
            ? { checks: {}, status: "ready" }
            : [project],
    })),
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete project: busy.mp4" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Wait for discovery",
  );
  expect(
    screen.getByRole("button", { name: "Delete project: busy.mp4" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Delete permanently" }),
  ).toBeEnabled();
});
