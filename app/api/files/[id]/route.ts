import { NextResponse } from "next/server";
import { currentUser, courseRole } from "@/lib/auth";
import { getAttempt } from "@/lib/exam";
import { getFileMeta, readFile } from "@/lib/files";

/** Downloads an uploaded submission file. Allowed for the student who uploaded it and the course's teachers. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });
  const meta = await getFileMeta(id);
  if (!meta?.complete) return new NextResponse("Not found", { status: 404 });
  const a = await getAttempt(meta.attempt_id);
  if (!a) return new NextResponse("Not found", { status: 404 });
  if (a.user_id !== user.id && (await courseRole(a.course_id, user.id)) !== "teacher") return new NextResponse("Forbidden", { status: 403 });
  const body = await readFile(id);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta.name || "submission")}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
