import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getExam } from "@/lib/exam";
import { baseUrl, grantLockdownPass, verifySebHeaders } from "@/lib/seb-access";

/**
 * Lockdown gate. Safe Exam Browser starts here (it is the config's startURL).
 * 1. SEB for Windows (and the classic WebView) sends key hashes as request headers → verified right here.
 * 2. Otherwise this page asks the SEB JavaScript API (macOS/iOS modern WebView)'s native
 *    plugin for the hash of this page's URL, posts it to /api/lockdown/verify, then continues to the exam.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const exam = await getExam(id);
  if (!exam) return new NextResponse("Not found", { status: 404 });
  const user = await currentUser();
  const path = `/exams/${exam.id}/lockdown${req.nextUrl.search}`;
  if (!user) return NextResponse.redirect(`${await baseUrl()}/login?next=${encodeURIComponent(path)}`);
  if ((await verifySebHeaders(exam, path))) {
    await grantLockdownPass(exam.id, user.id, "seb");
    return NextResponse.redirect(`${await baseUrl()}/exams/${exam.id}`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Checking secure browser…</title>
<style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:1rem;text-align:center;background:#f6f7f9;color:#1b1f24}
.c{max-width:420px}a{color:#1f6f5c}</style></head>
<body><div class="c"><h1 style="font-size:1.3rem">Checking your secure browser…</h1><p id="m">One moment.</p></div>
<script>
(async function(){
  var m=document.getElementById('m');
  var url=location.href.split('#')[0];
  var body={examId:${JSON.stringify(exam.id)},url:url};
  function wait(ms){return new Promise(function(r){setTimeout(r,ms)})}
  try{
    var seb=window.SafeExamBrowser;
    if(seb&&seb.security){
      if(typeof seb.security.updateKeys==='function'){await new Promise(function(r){seb.security.updateKeys(r);setTimeout(r,1500)})}
      body.configKey=seb.security.configKey||null; body.browserExamKey=seb.security.browserExamKey||null;
    }
    var res=await fetch('/api/lockdown/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});
    var j=await res.json();
    if(j.ok){location.replace('/exams/${exam.id}');return;}
    m.innerHTML='This exam must be opened in Safe Exam Browser. <a href="/exams/${exam.id}">Back to the exam page</a>';
  }catch(e){m.textContent='Could not verify the secure browser: '+e;}
})();
</script></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
