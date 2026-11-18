"use client";
import { useEffect, useState } from "react";

/** datetime-local input that shows and submits the teacher's local time; the form also carries tz_offset. */
export default function DateTimeField({ name, iso, id }: { name: string; iso: string | null; id?: string }) {
  const [v, setV] = useState("");
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    setV(local.toISOString().slice(0, 16));
  }, [iso]);
  return <input id={id} type="datetime-local" name={name} value={v} onChange={(e) => setV(e.target.value)} />;
}

export function TzOffset() {
  const [o, setO] = useState("0");
  useEffect(() => setO(String(new Date().getTimezoneOffset())), []);
  return <input type="hidden" name="tz_offset" value={o} />;
}
