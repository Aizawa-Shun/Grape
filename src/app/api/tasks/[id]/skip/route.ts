import { NextResponse } from "next/server";

import { skipTask } from "@/core/action/execute";
import { assertTaskOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

export const POST = route(
  "task.skip",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    // A task reaches its owner through its product, which is the only place
    // tenancy is recorded.
    await assertTaskOwner(id, requireUserId());

    const task = await skipTask(id);
    return NextResponse.json({ task });
  },
);
