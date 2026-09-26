import { describe, expect, it } from "vitest";

import type { ProductKnowledge } from "@/db/schema";

import { applyAnswer, findEvidence, mergeQuestions, normalizeFact, structuralQuestions, tally, verifyFacts, type SourcePage } from "./facts";

const pages: SourcePage[] = [
  { url: "https://x.example/", title: "Shot — Screenshot API", text: "We render 6.6M+ screenshots.\n\nOnly successful renders are billed. Trusted by 3,800  developers." },
  { url: "https://x.example/pricing", title: null, text: "Basic $17 per month for 2,000 screenshots." },
];

function knowledge(overrides: Partial<ProductKnowledge> = {}): ProductKnowledge {
  return {
    id: "p",
    productId: "p",
    what: null,
    targetUsers: [],
    problems: [],
    benefits: [],
    features: [],
    differentiators: [],
    useCases: [],
    pricing: [],
    proof: [],
    questions: [],
    brandVoice: null,
    contextVersion: 1,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("findEvidence", () => {
  it("finds a quote across whitespace, case and width differences, crediting the page it is on", () => {
    expect(findEvidence("only successful renders are billed.", pages, "https://x.example/pricing")).toEqual({
      url: "https://x.example/",
      quote: "only successful renders are billed.",
    });
    expect(findEvidence("Trusted by 3,800 developers", pages)?.url).toBe("https://x.example/");
  });

  it("tolerates the quote marks and ellipsis a model wraps a quote in", () => {
    expect(findEvidence("「We render 6.6M+ screenshots…」", pages)?.url).toBe("https://x.example/");
  });

  it("finds nothing for a sentence that is not there, or one too short to mean anything", () => {
    expect(findEvidence("99.99% uptime guaranteed", pages)).toBeNull();
    expect(findEvidence("the", pages)).toBeNull();
  });
});

describe("verifyFacts", () => {
  it("keeps a claim as known only when its quote is really on the site", () => {
    const facts = verifyFacts(
      [
        { text: "成功したレンダリングだけが課金される", status: "known", quote: "Only successful renders are billed.", url: "https://x.example/" },
        { text: "稼働率99.99%を保証している", status: "known", quote: "99.99% uptime guaranteed", url: "https://x.example/" },
        { text: "開発者向けである", status: "assumption", quote: "", url: "" },
        { text: "課金は月額である", status: "known", quote: "", url: "" },
      ],
      pages,
    );
    expect(facts.map((f) => [f.status, f.basis])).toEqual([
      ["known", "site"],
      ["assumption", "inference"],
      ["assumption", "inference"],
      ["assumption", "inference"],
    ]);
    expect(facts[0].evidence[0].url).toBe("https://x.example/");
    expect(facts[1].evidence).toEqual([]);
  });

  it("drops empty and duplicate claims", () => {
    const facts = verifyFacts(
      [
        { text: "同じ内容", status: "assumption", quote: "", url: "" },
        { text: "同じ　内容", status: "assumption", quote: "", url: "" },
        { text: "  ", status: "assumption", quote: "", url: "" },
      ],
      pages,
    );
    expect(facts).toHaveLength(1);
  });
});

describe("normalizeFact", () => {
  it("lets the owner's words be known, but no one claim a site source without evidence", () => {
    expect(normalizeFact({ text: "a", status: "assumption", basis: "owner", evidence: [] }).status).toBe("known");
    expect(normalizeFact({ text: "a", status: "known", basis: "site", evidence: [] })).toMatchObject({ status: "assumption", basis: "inference" });
    expect(normalizeFact({ text: "a", status: "known", basis: "inference", evidence: [] }).status).toBe("assumption");
  });
});

describe("questions", () => {
  it("asks about every topic with nothing known in it, offering the assumption as a guess", () => {
    const k = knowledge({
      what: { text: "スクショAPI", status: "known", basis: "site", evidence: [] },
      targetUsers: [{ text: "開発者", status: "assumption", basis: "inference", evidence: [] }],
    });
    const topics = structuralQuestions(k).map((q) => q.topic);
    expect(topics).toEqual(["targetUsers", "problems", "differentiators", "pricing", "proof"]);
    expect(structuralQuestions(k)[0].guess).toBe("開発者");
  });

  it("prefers the model's question on a topic and adds the checklist's for the rest", () => {
    const merged = mergeQuestions(
      [{ id: "q1", topic: "pricing", question: "無料プランはずっと無料ですか？", whyItMatters: "w", guess: null }],
      knowledge(),
    );
    expect(merged.filter((q) => q.topic === "pricing").map((q) => q.id)).toEqual(["q1"]);
    expect(merged.some((q) => q.topic === "proof")).toBe(true);
  });

  it("turns an answer into the owner's fact and closes the question", () => {
    const k = knowledge({ questions: [{ id: "q1", topic: "proof", question: "?", whyItMatters: "", guess: null }] });
    const next = applyAnswer(k, "q1", " 3,800人が使っています ");
    expect(next.questions).toEqual([]);
    expect(next.proof).toEqual([{ text: "3,800人が使っています", status: "known", basis: "owner", evidence: [] }]);
    expect(tally(next)).toEqual({ known: 1, assumption: 0, questions: 0 });
  });
});
