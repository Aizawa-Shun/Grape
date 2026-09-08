import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Field, controlClass } from "./field";

describe("Button", () => {
  it("blocks clicks while loading and says so out loud", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        診断中
      </Button>,
    );

    const button = screen.getByRole("button", { name: /診断中/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps its label visible while loading rather than swapping it out", () => {
    render(<Button loading>本文を生成</Button>);

    expect(screen.getByRole("button", { name: /本文を生成/ })).toBeInTheDocument();
  });

  it("is not busy when idle", () => {
    render(<Button>承認して実行</Button>);

    const button = screen.getByRole("button", { name: "承認して実行" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });
});

describe("Field", () => {
  it("associates the label with the control it wraps", async () => {
    render(
      <Field label="ゴールの操作">
        {(props) => <input {...props} className={controlClass} />}
      </Field>,
    );

    const input = screen.getByLabelText("ゴールの操作");
    await userEvent.type(input, "signup");
    expect(input).toHaveValue("signup");
  });

  it("points the control at its hint so the explanation is read out with it", () => {
    render(
      <Field label="ゴールの操作" hint="登録が完了したときに送る名前">
        {(props) => <input {...props} />}
      </Field>,
    );

    const input = screen.getByLabelText("ゴールの操作");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("登録が完了したときに送る名前");
  });
});
