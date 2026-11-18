import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser, courseRole } from "@/lib/auth";
import { get, UPLOAD_DIR } from "@/lib/db";

/** Downloads an uploaded submission file. Allowed for the student who uploaded it and the course's teachers. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });
  const r = get(
    `SELECT r.file_path, r.file_name, a.user_id, e.course_id FROM responses r
     JOIN attempts a ON a.id = r.attempt_id JOIN exams e ON e.id = a.exam_id WHERE r.id = ?`,
    Number(id)
  );
  if (!r?.file_path) return new NextResponse("Not found", { status: 404 });
  if (r.user_id !== user.id && courseRole(r.course_id, user.id) !== "teacher") return new NextResponse("Forbidden", { status: 403 });
  const file = path.join(UPLOAD_DIR, path.basename(r.file_path));
  if (!fs.existsSync(file)) return new NextResponse("Missing", { status: 404 });
  return new NextResponse(fs.readFileSync(file), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${encodeURIComponent(r.file_name || "submission")}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
