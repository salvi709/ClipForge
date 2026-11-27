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

describe("ClipForge teaser landing page and routing", () => {
  it("renders the mystery-driven landing sections, floating fragments, interactive previews, and legal routes", () => {
    render(<RootRouter />);

    expect(
      screen.getByRole("heading", {
        name: "Every Long Video Has Its Moments.",
      }),
    ).toBeInTheDocument();

    const primaryNav = within(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    );
    expect(primaryNav.getByRole("link", { name: "Inside" })).toBeInTheDocument();
    expect(primaryNav.getByRole("link", { name: "Experience" })).toBeInTheDocument();
    expect(primaryNav.getByRole("link", { name: "Use Cases" })).toBeInTheDocument();

    // Switch moment inside Hero fragment stage
    fireEvent.click(screen.getByRole("button", { name: /Quiet Before the Payoff/i }));
    expect(screen.getAllByText(/11:08/).length).toBeGreaterThan(0);

    // Interactive Visual Interlude strip
    const filmstrip = within(
      screen.getByRole("group", { name: /Video moments filmstrip/i }),
    );
    fireEvent.click(filmstrip.getByRole("button", { name: /19:34/i }));
    expect(screen.getByText(/Closing payoff/i)).toBeInTheDocument();

    // Interactive Aspect ratio toggle in Creative Experience
    const wideButton = screen.getByRole("button", { name: "16:9" });
    fireEvent.click(wideButton);
    expect(wideButton).toHaveClass("active");
    expect(screen.getAllByText("16:9").length).toBeGreaterThanOrEqual(2);

    // Compact 5 Use Cases
    expect(screen.getByRole("heading", { name: "Gaming" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Podcasts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Education" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vlogs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Entertainment" })).toBeInTheDocument();

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

  it("navigates from Explore ClipForge / Start Exploring into the workspace at /app and back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RootRouter />);

    fireEvent.click(screen.getByRole("button", { name: /Start Exploring/i }));

    expect(window.location.pathname).toBe("/app");
    expect(screen.getByText("Engine disconnected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Overview site" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overview site" }));
    expect(window.location.pathname).toBe("/");
    expect(
      screen.getByRole("heading", {
        name: "Every Long Video Has Its Moments.",
      }),
    ).toBeInTheDocument();
  });
});
