import { NextResponse } from "next/server";

import { getFunnel } from "@/core/data/funnel";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 90;

export const GET = route(
  "funnel.read",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const requested = Number(new URL(request.url).searchParams.get("windowDays") ?? "30");
    const windowDays = Number.isFinite(requested)
      ? Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.trunc(requested)))
      : 30;

    const funnel = await getFunnel(id, { windowDays });
    return NextResponse.json(funnel);
  },
);
