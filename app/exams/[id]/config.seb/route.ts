import { NextResponse } from "next/server";
import { getExam } from "@/lib/exam";
import { baseUrl, examSebConfig } from "@/lib/seb-access";
import { toPlistXml } from "@/lib/seb";

/**
 * Serves the unencrypted SEB config for an exam that requires a lockdown browser.
 * Public on purpose: SEB fetches it through seb:// / sebs:// links without the student's browser cookies.
 * It contains no secrets (only the SHA-256 of the optional quit password).
 */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const exam = getExam(Number(id));
  if (!exam || !exam.published || !exam.require_lockdown) return new NextResponse("Not found", { status: 404 });
  const xml = toPlistXml(examSebConfig(exam, await baseUrl()));
  return new NextResponse(xml, {
    headers: {
      "content-type": "application/seb",
      "content-disposition": `attachment; filename="exam-${exam.id}.seb"`,
      "cache-control": "private, max-age=1, no-transform",
    },
  });
}
