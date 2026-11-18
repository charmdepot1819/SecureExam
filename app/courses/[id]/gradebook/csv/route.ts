import { NextResponse } from "next/server";
import { currentUser, courseRole } from "@/lib/auth";
import { gradebook } from "@/lib/gradebook";

const q = (v: any) => {
  const s = String(v ?? "");
  // Neutralize spreadsheet formula injection and quote every field.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const u = await currentUser();
  if (!u || (await courseRole(id, u.id)) !== "teacher") return new NextResponse("Forbidden", { status: 403 });
  const { exams, rows } = await gradebook(id);
  const header: any[] = ["Student", "Email", ...exams.flatMap((x) => [`${x.title} score`, `${x.title} max`]), "Total %"];
  const lines = rows.map((r) => [
    r.student.name,
    r.student.email,
    ...r.cells.flatMap((c): any[] => (c.status === "graded" ? [c.score, c.max] : [c.status ?? "", ""])),
    r.possible ? Math.round((r.earned / r.possible) * 1000) / 10 : "",
  ]);
  const csv = [header, ...lines].map((l) => l.map(q).join(",")).join("\r\n");
  return new NextResponse("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="gradebook-course-${id}.csv"` },
  });
}
