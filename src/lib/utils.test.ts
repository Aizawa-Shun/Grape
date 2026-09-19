import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("結合した複数のクラス名を返す", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("競合するTailwindクラスは後勝ちでマージする", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("falsyな値は無視する", () => {
    expect(cn("px-2", false, undefined, null, "text-sm")).toBe("px-2 text-sm");
  });
});
