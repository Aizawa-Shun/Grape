"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { BrandVoice, GrowthPolicy } from "@/db/schema";

import { send } from "../request";

function useSave() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  function save(path: string, method: "PUT" | "POST", body: unknown) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await send(path, method, body);
      if (!result.ok) return setError(result.error);
      setSaved(true);
      router.refresh();
    });
  }
  return { save, error, saved, pending };
}

function Footer({ pending, saved, error, label = "保存する" }: { pending: boolean; saved: boolean; error: string | null; label?: string }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {label}
        </Button>
        {saved && <span className="text-xs text-positive">保存しました</span>}
      </div>
      {error && <Status tone="error">{error}</Status>}
    </>
  );
}

export function GoalForm({ productId, initial }: { productId: string; initial: { metric: "signups" | "visitors"; target: number; days: number } }) {
  const [metric, setMetric] = useState(initial.metric);
  const [target, setTarget] = useState(String(initial.target));
  const [days, setDays] = useState(String(initial.days));
  const { save, error, saved, pending } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(`/api/growth/${productId}/goal`, "PUT", { metric, target, days });
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>今日から</span>
        <input aria-label="日数" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={`${controlClass} w-20 text-right`} />
        <span>日で</span>
        <select aria-label="数えるもの" value={metric} onChange={(e) => setMetric(e.target.value as "signups" | "visitors")} className={`${controlClass} w-auto`}>
          <option value="signups">登録ユーザー</option>
          <option value="visitors">訪問者</option>
        </select>
        <span>を</span>
        <input aria-label="目標の人数" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} className={`${controlClass} w-24 text-right`} />
        <span>人</span>
      </div>
      <p className="text-xs text-text-muted">新しい目標は今日から数え直します。前の目標は記録に残ります。</p>
      <Footer pending={pending} saved={saved} error={error} label="目標を設定する" />
    </form>
  );
}

const MODES = [
  { value: "manual", label: "手動", body: "案は頼んだときだけ作る。出すものはすべて承認する。" },
  { value: "assisted", label: "アシスト（おすすめ）", body: "AIが毎日案を作り、承認したものだけが出ていく。" },
  { value: "autonomous", label: "自律", body: "下のルールの範囲で、AIが承認なしで投稿・返信する。" },
] as const;

export function PolicyForm({ productId, policy }: { productId: string; policy: GrowthPolicy }) {
  const [form, setForm] = useState({
    approvalMode: policy.approvalMode,
    maxPostsPerDay: String(policy.maxPostsPerDay),
    maxRepliesPerDay: String(policy.maxRepliesPerDay),
    minRelevance: String(policy.minRelevance),
    blockKeywords: policy.blockKeywords.join("\n"),
    competitorMentions: policy.competitorMentions,
    promotionalIntensity: String(policy.promotionalIntensity),
    quietHoursStart: String(policy.quietHoursStart),
    quietHoursEnd: String(policy.quietHoursEnd),
  });
  const { save, error, saved, pending } = useSave();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      form.approvalMode === "autonomous" &&
      policy.approvalMode !== "autonomous" &&
      !window.confirm("自律モードでは、AIがあなたの承認なしにXへ投稿・返信します（練習モードがオフのとき）。取り消せない操作です。本当に切り替えますか？")
    ) {
      return;
    }
    save(`/api/growth/${productId}/policy`, "PUT", {
      ...form,
      blockKeywords: form.blockKeywords.split("\n").map((k) => k.trim()).filter(Boolean),
    });
  }

  const number = (key: keyof typeof form, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {(props) => <input {...props} inputMode="numeric" value={form[key]} onChange={set(key)} className={`${controlClass} w-28`} />}
    </Field>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">承認モード</legend>
        {MODES.map((mode) => (
          <label key={mode.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="approvalMode" value={mode.value} checked={form.approvalMode === mode.value} onChange={set("approvalMode")} className="mt-1" />
            <span>
              <span className="font-medium">{mode.label}</span>
              <span className="text-text-muted"> — {mode.body}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        {number("maxPostsPerDay", "1日の投稿の上限")}
        {number("maxRepliesPerDay", "1日の返信の上限")}
        {number("minRelevance", "関連度の下限（%）", "これ未満の会話は表示せず、自律モードでも返信しない")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="宣伝の強さ" hint="1 = 製品にほぼ触れない ／ 5 = 積極的に紹介する">
          {(props) => (
            <select {...props} value={form.promotionalIntensity} onChange={set("promotionalIntensity")} className={`${controlClass} w-auto`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="競合への言及">
          {(props) => (
            <select {...props} value={form.competitorMentions} onChange={set("competitorMentions")} className={`${controlClass} w-auto`}>
              <option value="never">名前を出さない</option>
              <option value="neutral">中立に触れてよい</option>
              <option value="allowed">比較してよい</option>
            </select>
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <Field label="自動で投稿しない時間帯（日本時間）">
          {(props) => <input {...props} inputMode="numeric" value={form.quietHoursStart} onChange={set("quietHoursStart")} className={`${controlClass} w-20`} />}
        </Field>
        <span className="pb-2">時 〜</span>
        <input aria-label="終了時刻" inputMode="numeric" value={form.quietHoursEnd} onChange={set("quietHoursEnd")} className={`${controlClass} w-20`} />
        <span className="pb-2">時</span>
      </div>

      <Field label="禁止ワード" hint="1行に1つ。含む会話は拾わず、含む投稿は出しません。">
        {(props) => <textarea {...props} rows={3} value={form.blockKeywords} onChange={set("blockKeywords")} className={controlClass} />}
      </Field>

      <Footer pending={pending} saved={saved} error={error} />
    </form>
  );
}

export function BrandVoiceForm({ productId, voice }: { productId: string; voice: BrandVoice | null }) {
  const [samples, setSamples] = useState(voice?.samples.join("\n---\n") ?? "");
  const { save, error, saved, pending } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(`/api/growth/${productId}/brand-voice`, "POST", {
          samples: samples.split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean),
        });
      }}
      className="flex flex-col gap-3"
    >
      {voice && (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 rounded-md border border-border bg-surface-sunken p-3 text-xs">
          <dt className="text-text-muted">トーン</dt>
          <dd>{voice.tone}</dd>
          <dt className="text-text-muted">文の長さ</dt>
          <dd>{voice.sentenceLength}</dd>
          <dt className="text-text-muted">絵文字</dt>
          <dd>{voice.emoji}</dd>
          <dt className="text-text-muted">丁寧さ</dt>
          <dd>{voice.formality}</dd>
          <dt className="text-text-muted">ユーモア</dt>
          <dd>{voice.humor}</dd>
          <dt className="text-text-muted">指針</dt>
          <dd>{voice.guidelines.join(" ／ ")}</dd>
        </dl>
      )}
      <Field label="あなたが書いた文章のサンプル" hint="過去の投稿などを2〜10件。「---」だけの行で区切ってください。">
        {(props) => <textarea {...props} rows={8} value={samples} onChange={(e) => setSamples(e.target.value)} className={controlClass} />}
      </Field>
      <Footer pending={pending} saved={saved} error={error} label={voice ? "文体を学び直す" : "文体を学ばせる"} />
    </form>
  );
}
