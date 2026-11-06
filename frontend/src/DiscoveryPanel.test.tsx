import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DiscoveryPanel from "./DiscoveryPanel";
import { Clip } from "./api";

const clip: Clip = {
  id: "clip-a",
  rank: 1,
  title: "How models learn from examples",
  start: 10,
  end: 35,
  duration: 25,
  score: 77,
  reason: "Explains learning with a complete example.",
  evidence: "learn patterns from examples",
  excerpt: "Models learn patterns from examples and classify new articles.",
  original_start: 10,
  original_end: 35,
  adjusted: false,
  duration_exception: false,
  criteria: {
    hook_strength: 3,
    informational_value: 4,
    context_completeness: 4,
    clarity: 4,
  },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("finds clips, previews a range, exposes evidence and validates manual edits", async () => {
  const request = vi.fn(async (url: string, options?: RequestInit) => ({
    ok: true,
    json: async () =>
      url.endsWith("/health")
        ? { status: "ready", model: "test-local", message: "Ready" }
        : options?.method === "POST" || options?.method === "PATCH"
          ? { status: "completed", clips: [clip] }
          : { status: "idle", clips: [] },
  }));
  vi.stubGlobal("fetch", request);
  const preview = vi.fn().mockResolvedValue(undefined),
    seek = vi.fn();
  render(
    <DiscoveryPanel
      projectId="saved"
      ready
      duration={100}
      connected
      previewing={false}
      onPreview={preview}
      onStop={vi.fn()}
      onSeek={seek}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find Best Clips" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Preview clip 1" }),
  );
  expect(preview).toHaveBeenCalledWith(10, 35);
  expect(screen.getByText(clip.excerpt)).toBeInTheDocument();
  expect(screen.getByText(/Selection evidence/)).toHaveTextContent(
    clip.evidence,
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Clip 1 end seconds" }),
    { target: { value: "200" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save range" }));
  expect(screen.getByRole("alert")).toHaveTextContent("within the video");
  expect(
    request.mock.calls.filter(([, options]) => options?.method === "PATCH"),
  ).toHaveLength(0);
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Clip 1 end seconds" }),
    { target: { value: "30" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save range" }));
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([, options]) =>
          options?.body === JSON.stringify({ start: 10, end: 30 }),
      ),
    ).toBe(true),
  );
});

it("shows missing-model instructions without creating fake suggestions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/health")
          ? {
              status: "model_missing",
              model: "qwen3:4b",
              message: "Run ollama pull qwen3:4b.",
            }
          : { status: "idle", clips: [] },
    })),
  );
  render(
    <DiscoveryPanel
      projectId="saved"
      ready
      duration={100}
      connected
      previewing={false}
      onPreview={vi.fn()}
      onStop={vi.fn()}
      onSeek={vi.fn()}
    />,
  );
  expect(await screen.findByText(/Run ollama pull/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Preview clip/ }),
  ).not.toBeInTheDocument();
});

function panel(duration = 150) {
  return render(<DiscoveryPanel projectId="saved" ready duration={duration} connected previewing={false} onPreview={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} />);
}

function mockResult(initial: Record<string, unknown> = { status: "idle", clips: [] }) {
  const request = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => url.endsWith("/health")
    ? { status: "ready", model: "qwen2.5:3b" }
    : options?.method === "POST" ? { status: "completed", clips: [clip], message: "Found 1 strong clips out of 3 requested." } : initial }));
  vi.stubGlobal("fetch", request);
  return request;
}

it.each([
  ["short", 15, 30], ["standard", 30, 60], ["long", 60, 90],
])("sends %s duration and requested count to the real API contract", async (preset, minimum, maximum) => {
  const request = mockResult(); panel();
  await screen.findByText("qwen2.5:3b");
  fireEvent.change(screen.getByRole("slider", { name: "Number of clips" }), { target: { value: "3" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Clip duration" }), { target: { value: preset } });
  fireEvent.click(screen.getByRole("button", { name: "Find Best Clips" }));
  await screen.findByRole("button", { name: "Preview clip 1" });
  const post = request.mock.calls.find(([, options]) => options?.method === "POST");
  expect(JSON.parse(post![1]!.body as string)).toEqual({ clip_count: 3, min_seconds: minimum, max_seconds: maximum });
  expect(screen.getByText("Found 1 strong clips out of 3 requested.")).toBeInTheDocument();
});

it("validates custom duration and short sources before submitting", async () => {
  const request = mockResult(); panel(20);
  await screen.findByText("qwen2.5:3b");
  expect(screen.getByRole("alert")).toHaveTextContent("shorter than the 30s minimum");
  const button = screen.getByRole("button", { name: "Find Best Clips" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "Clip duration" }), { target: { value: "custom" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum clip duration" }), { target: { value: "19" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum clip duration" }), { target: { value: "18" } });
  expect(button).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("minimum smaller");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum clip duration" }), { target: { value: "20" } });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await screen.findByRole("button", { name: "Preview clip 1" });
  expect(JSON.parse(request.mock.calls.find(([, options]) => options?.method === "POST")![1]!.body as string)).toEqual({ clip_count: 5, min_seconds: 19, max_seconds: 20 });
});

it("restores saved settings without overwriting later unsaved changes", async () => {
  mockResult({ status: "completed", clips: [clip], settings: { clip_count: 2, min_seconds: 12, max_seconds: 26 }, result_settings: { clip_count: 2, min_seconds: 12, max_seconds: 26 } });
  panel();
  await screen.findByRole("button", { name: "Preview clip 1" });
  expect(screen.getByRole("slider", { name: "Number of clips" })).toHaveValue("2");
  expect(screen.getByRole("combobox", { name: "Clip duration" })).toHaveValue("custom");
  expect(screen.getByRole("spinbutton", { name: "Minimum clip duration" })).toHaveValue(12);
});

it("shows measured assessment progress, prevents duplicate jobs, and shows cancellation", async () => {
  let result = { status: "evaluating_candidates", clips: [], evaluated: 2, total: 8, progress: { completed_stages: ["preparing_transcript"], elapsed_seconds: 12 } } as Record<string, unknown>;
  const request = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => {
    if (url.endsWith("/health")) return { status: "ready", model: "qwen2.5:3b" };
    if (options?.method === "POST") result = { status: "cancelled", clips: [], progress: { elapsed_seconds: 13 } };
    return result;
  }}));
  vi.stubGlobal("fetch", request); panel();
  expect(await screen.findByText("2 of 8 candidates assessed · 25% of assessment stage")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Candidates assessed" })).toHaveAttribute("value", "2");
  expect(screen.getByRole("button", { name: "Find Best Clips" })).toBeDisabled();
  expect(screen.getByRole("slider", { name: "Number of clips" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel discovery" }));
  expect(await screen.findByText("Analysis cancelled")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(request.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});

it("polls real stage transitions and retains earlier suggestions on failure", async () => {
  vi.useFakeTimers();
  let current: Record<string, unknown> = { status: "evaluating_candidates", clips: [], evaluated: 0, total: 4 };
  mockResult();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("/health") ? { status: "ready", model: "qwen2.5:3b" } : current })));
  panel(); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("button", { name: "Cancel discovery" })).toBeInTheDocument();
  current = { status: "failed", clips: [clip], previous_result: true, error: "Local AI timed out." };
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByText("Analysis failed")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Local AI timed out");
  expect(screen.getByText("Previous completed suggestions")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Preview clip 1" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel discovery" })).not.toBeInTheDocument();
});

it("labels lower-confidence results separately without calling them top ranked", async () => {
  mockResult({ status: "completed", clips: [{ ...clip, confidence: "lower", score: 45, quality_rejections: ["model_suitable_false", "informational_value_below_3_of_5"] }] });
  panel();
  expect(await screen.findByRole("heading", { name: "Lower-confidence suggestions" })).toBeInTheDocument();
  expect(screen.getByText(/Lower confidence ·/)).toHaveTextContent("informational value below 3 of 5");
  expect(screen.queryByText("Top ranked")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Preview clip 1" })).toBeInTheDocument();
});
