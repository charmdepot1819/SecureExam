"use client";
import { useEffect, useState } from "react";

const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };

/** Shows a date in the viewer's own time zone (the server doesn't know it). */
export default function When({ iso, empty = "—" }: { iso: string | null | undefined; empty?: string }) {
  const [text, setText] = useState<string>(iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : empty);
  useEffect(() => {
    if (iso) setText(new Date(iso).toLocaleString(undefined, opts));
  }, [iso]);
  return <time dateTime={iso || undefined}>{text}</time>;
}
