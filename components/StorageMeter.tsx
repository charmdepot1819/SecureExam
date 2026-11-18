/**
 * Shows how much of Firestore's free 1 GiB (Spark plan) uploads use. Grades, questions and other
 * records also count toward the 1 GiB, but they are small next to files.
 */
const FREE_BYTES = 1024 * 1024 * 1024;

export default function StorageMeter({ bytes, label }: { bytes: number; label?: string }) {
  const pct = Math.min(100, (bytes / FREE_BYTES) * 100);
  const tone = pct >= 80 ? "var(--danger)" : pct >= 60 ? "var(--warn, #b7791f)" : "var(--accent)";
  return (
    <div>
      <div className="spread" style={{ fontSize: "0.9rem" }}>
        <span>{label || "Uploaded files"}</span>
        <span>{(bytes / 1048576).toFixed(1)} MB of 1,024 MB free storage</span>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Free storage used"
        style={{ height: 10, borderRadius: 6, background: "var(--border)", overflow: "hidden", margin: "0.35rem 0" }}>
        <div style={{ width: `${Math.max(pct, bytes ? 1 : 0)}%`, height: "100%", background: tone }} />
      </div>
      {pct >= 80 && <p className="notice danger">Storage is almost full. Delete files from graded submissions (on each assessment's Submissions page) to free space.</p>}
    </div>
  );
}
