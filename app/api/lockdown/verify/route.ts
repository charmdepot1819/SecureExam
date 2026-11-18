import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getExam } from "@/lib/exam";
import { baseUrl, grantLockdownPass, hashesMatch } from "@/lib/seb-access";

/** Verifies key hashes reported by the SEB JavaScript API for the gate page URL. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const exam = getExam(Number(body.examId));
  if (!exam) return NextResponse.json({ ok: false }, { status: 404 });
  const base = await baseUrl();
  const url = String(body.url || "").split("#")[0];
  // The hash must be for this exam's gate page on this server, so a hash captured elsewhere can't be reused.
  const gate = `${base}/exams/${exam.id}/lockdown`;
  if (url !== gate && !url.startsWith(gate + "?")) return NextResponse.json({ ok: false, error: "Wrong page" }, { status: 400 });
  if (hashesMatch(exam, base, url, [body.configKey, body.browserExamKey])) {
    await grantLockdownPass(exam.id, user.id, "seb");
    return NextResponse.json({ ok: true, client: "seb" });
  }
  return NextResponse.json({ ok: false });
}
