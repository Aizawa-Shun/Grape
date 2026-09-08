import { NextResponse } from "next/server";

import { skipTask } from "@/core/action/execute";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

export const POST = route(
  "task.skip",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const task = await skipTask(id);
    return NextResponse.json({ task });
  },
);
