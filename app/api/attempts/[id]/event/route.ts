import { NextRequest, NextResponse } from "next/server";
import { reportIntegrityEvent } from "@/app/actions";

/**
 * Integrity events from the exam page. A plain endpoint (not a server action) so the page can send it with
 * fetch({keepalive: true}) at the moment it is hidden; mobile browsers may freeze the page right after.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const r = await reportIntegrityEvent(Number(id), String(body.type || "other"), String(body.detail || ""));
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 403 });
  }
}
