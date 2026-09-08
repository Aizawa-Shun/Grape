import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/core/intelligence/recommend";

import { TaskCard } from "./task-card";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    productId: "p1",
    diagnosisId: "d1",
    title: "OGP画像を用意する",
    rationale: "リンクを貼ったときに中身が伝わるようにするため。",
    stage: "reach",
    channel: "x",
    expectedMetric: "サイトに来た人",
    expectedDirection: "up",
    impact: 4,
    effort: 2,
    status: "proposed",
    dueWeek: "2026-W25",
    createdAt: new Date("2026-06-15T00:00:00Z"),
    completedAt: null,
    ...overrides,
  } as Task;
}

const artifact = {
  id: "a1",
  kind: "x_post",
  content: "新しいツールを作りました。",
  createdAt: new Date("2026-06-15T00:00:00Z"),
};

function mockFetch(status = 201) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => ({}),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("TaskCard approval gate", () => {
  it("does not send anything on the first press — it asks first", async () => {
    const fetchMock = mockFetch();
    render(
      <TaskCard
        task={task()}
        artifact={artifact}
        actionRun={null}
        costEstimateUsd={0.015}
        outcome={null}
        dryRun={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "内容を確認して実行" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows where it goes and what it costs before asking to confirm", async () => {
    mockFetch();
    render(
      <TaskCard
        task={task()}
        artifact={artifact}
        actionRun={null}
        costEstimateUsd={0.015}
        outcome={null}
        dryRun={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "内容を確認して実行" }));

    expect(screen.getByText("この内容で実行します")).toBeInTheDocument();
    expect(screen.getByText("約 $0.015")).toBeInTheDocument();
    expect(screen.getByText(/取り消せません/)).toBeInTheDocument();
  });

  it("only sends on the second, differently worded press", async () => {
    const fetchMock = mockFetch();
    render(
      <TaskCard
        task={task()}
        artifact={artifact}
        actionRun={null}
        costEstimateUsd={0.015}
        outcome={null}
        dryRun={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "内容を確認して実行" }));
    await userEvent.click(screen.getByRole("button", { name: "本当に送る" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/t1/approve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("backs out without sending", async () => {
    const fetchMock = mockFetch();
    render(
      <TaskCard
        task={task()}
        artifact={artifact}
        actionRun={null}
        costEstimateUsd={0.015}
        outcome={null}
        dryRun={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "内容を確認して実行" }));
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "内容を確認して実行" })).toBeInTheDocument();
  });

  it("says plainly that practice mode will not send, and softens the wording", async () => {
    mockFetch();
    render(
      <TaskCard
        task={task()}
        artifact={artifact}
        actionRun={null}
        costEstimateUsd={0.015}
        outcome={null}
        dryRun
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "内容を確認して実行" }));

    expect(screen.getByText(/実際には送られません/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "実行する" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "本当に送る" })).not.toBeInTheDocument();
  });

  it("never offers to send at all before a draft exists", () => {
    mockFetch();
    render(
      <TaskCard
        task={task()}
        artifact={null}
        actionRun={null}
        costEstimateUsd={null}
        outcome={null}
        dryRun={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "内容を確認して実行" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文面を作る" })).toBeInTheDocument();
  });

  it("surfaces the server's plain-language error instead of leaving the card silent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: "AIの返事が途中で壊れていて、読み取れませんでした。", code: "LLM_BAD_OUTPUT" }),
      }),
    );
    render(
      <TaskCard
        task={task()}
        artifact={null}
        actionRun={null}
        costEstimateUsd={null}
        outcome={null}
        dryRun
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "文面を作る" }));

    expect(await screen.findByRole("status")).toHaveTextContent("読み取れませんでした");
  });
});
