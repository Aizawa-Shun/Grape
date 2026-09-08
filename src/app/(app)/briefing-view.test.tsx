import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Briefing } from "@/core/product/briefing";

import { BriefingView } from "./briefing-view";

const product = { id: "p1", name: "Chess", url: "https://chess.example" };

function briefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    situation: "diagnosed",
    headline: "いま一番の問題は「中身を見てもらう」の段階です。",
    celebration: null,
    step: {
      kind: "generate_artifact",
      product,
      task: { id: "t1", title: "OGP画像を用意する" },
    },
    ...overrides,
  };
}

describe("BriefingView", () => {
  it("leads with where things stand, before anything else", () => {
    render(<BriefingView briefing={briefing()} />);

    expect(screen.getByText(/いま一番の問題は/)).toBeInTheDocument();
  });

  it("offers exactly one thing to do, not a list", () => {
    render(<BriefingView briefing={briefing()} />);

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/products/p1/tasks");
  });

  it("says so in people, not percentages, when something worked", () => {
    render(
      <BriefingView
        briefing={briefing({
          celebration: {
            taskTitle: "OGP画像を用意する",
            stage: "engage",
            before: 20,
            after: 34,
            delta: 14,
            windowDays: 7,
          },
        })}
      />,
    );

    expect(screen.getByText("効きました")).toBeInTheDocument();
    // Scoped to the celebration: the headline in this fixture names the same
    // stage, and the point of the assertion is what the result block says.
    expect(screen.getByText(/のあと、/)).toHaveTextContent(
      "「OGP画像を用意する」のあと、中身を見てもらうが 20 人から 34 人 に増えました（7日後）。",
    );
  });

  it("stays quiet about results when there are none to report", () => {
    render(<BriefingView briefing={briefing()} />);

    expect(screen.queryByText("効きました")).not.toBeInTheDocument();
  });

  it("does not push an action when the honest answer is to wait", () => {
    render(
      <BriefingView
        briefing={briefing({
          situation: "awaiting_outcome",
          headline: "やったことの効果が出るのを待っています。",
          step: {
            kind: "waiting",
            product,
            task: { id: "t1", title: "OGP画像を用意する" },
            readyAt: new Date("2026-06-20T00:00:00Z"),
          },
        })}
      />,
    );

    expect(screen.getByText("いま急いでやることはありません")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/products/p1/funnel");
  });

  it("points a brand-new reader at the form rather than at a product that does not exist", () => {
    render(
      <BriefingView
        briefing={briefing({
          situation: "unregistered",
          headline: "まだ何も登録されていません。",
          step: { kind: "register" },
        })}
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute("href", "#register");
  });
});
