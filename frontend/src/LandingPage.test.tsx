import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootRouter from "./RootRouter";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("scrollTo", vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("ClipForge marketing site and routing", () => {
  it("renders the landing page at / with interactive showcase, FAQ accordion, and legal routes", () => {
    render(<RootRouter />);

    expect(
      screen.getByRole("heading", {
        name: "Turn Long Videos Into Moments Worth Watching.",
      }),
    ).toBeInTheDocument();

    const primaryNav = within(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    );
    expect(primaryNav.getByRole("link", { name: "Features" })).toBeInTheDocument();
    expect(primaryNav.getByRole("link", { name: "How It Works" })).toBeInTheDocument();
    expect(primaryNav.getByRole("link", { name: "Use Cases" })).toBeInTheDocument();
    expect(primaryNav.getByRole("link", { name: "FAQ" })).toBeInTheDocument();

    // Switch interactive showcase tabs
    fireEvent.click(screen.getByRole("tab", { name: /Transcript/i }));
    expect(
      screen.getByPlaceholderText(/Filter preview transcript/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Enhancement/i }));
    expect(screen.getByText(/GENERATED TITLE HOOKS/i)).toBeInTheDocument();

    // Toggle FAQ accordion item
    const youtubeQuestion = screen.getByRole("button", {
      name: /Can ClipForge work with YouTube videos\?/i,
    });
    expect(youtubeQuestion).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(youtubeQuestion);
    expect(youtubeQuestion).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(/import your own SRT, VTT, or plain-text transcript/i),
    ).toBeInTheDocument();

    // Navigate to Privacy Policy and back
    fireEvent.click(screen.getByRole("link", { name: "Privacy Policy" }));
    expect(window.location.pathname).toBe("/privacy");
    expect(
      screen.getByRole("heading", { name: "Privacy Policy" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Back to ClipForge overview/i }),
    );
    expect(window.location.pathname).toBe("/");
  });

  it("navigates from Get Started into the workspace at /app and back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RootRouter />);

    const getStartedButtons = screen.getAllByRole("button", {
      name: /Get Started/i,
    });
    fireEvent.click(getStartedButtons[0]);

    expect(window.location.pathname).toBe("/app");
    expect(screen.getByText("Engine disconnected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Overview site" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overview site" }));
    expect(window.location.pathname).toBe("/");
    expect(
      screen.getByRole("heading", {
        name: "Turn Long Videos Into Moments Worth Watching.",
      }),
    ).toBeInTheDocument();
  });
});
