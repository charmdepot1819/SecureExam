// Verifies the Config Key implementation against a real SEB config file whose
// Config Key is known (fixture and expected hash from Moodle's quizaccess_seb test suite).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configKey, urlKeyHash, PReal, PDate, PData, type PValue } from "../lib/seb.ts";

function parsePlist(xml: string): any {
  const tokens = xml
    .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, "")
    .match(/<[^>]+>|[^<]+/g)!
    .filter((t) => t.trim() !== "" || false);
  let i = 0;
  const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const text = (tag: string) => {
    let out = "";
    while (!tokens[i].startsWith(`</${tag}`)) out += tokens[i++];
    i++;
    return unesc(out);
  };
  function val(): PValue {
    const t = tokens[i++].trim();
    if (/^<plist/.test(t)) { const v = val(); i++; return v; }
    if (/^<true\s*\/>$/.test(t)) return true;
    if (/^<false\s*\/>$/.test(t)) return false;
    if (/^<string\s*\/>$/.test(t)) return "";
    if (/^<dict\s*\/>$/.test(t)) return {};
    if (/^<array\s*\/>$/.test(t)) return [];
    if (/^<data\s*\/>$/.test(t)) return new PData(Buffer.alloc(0));
    if (t === "<string>") return text("string");
    if (t === "<integer>") return parseInt(text("integer"), 10);
    if (t === "<real>") return new PReal(parseFloat(text("real")));
    if (t === "<date>") return new PDate(new Date(text("date")));
    if (t === "<data>") return new PData(Buffer.from(text("data").replace(/\s+/g, ""), "base64"));
    if (t === "<array>") {
      const arr: PValue[] = [];
      while (tokens[i].trim() !== "</array>") { if (tokens[i].trim() === "") { i++; continue; } arr.push(val()); }
      i++;
      return arr;
    }
    if (t === "<dict>") {
      const d: Record<string, PValue> = {};
      while (tokens[i].trim() !== "</dict>") {
        if (tokens[i].trim() === "") { i++; continue; }
        i++; // <key>
        const k = text("key");
        while (tokens[i].trim() === "") i++;
        d[k] = val();
      }
      i++;
      return d;
    }
    throw new Error("Unexpected token " + t);
  }
  while (tokens[i].trim() === "") i++;
  return val();
}

test("Config Key matches SEB reference value (macOS 2.1.4 config)", () => {
  const xml = fs.readFileSync(path.join(import.meta.dirname, "fixtures/unencrypted_mac_001.seb"), "utf8");
  assert.equal(configKey(parsePlist(xml)), "4fa9af8ec8759eb7c680752ef4ee5eaf1a860628608fccae2715d519849f9292");
});

test("Empty config hashes to SHA-256 of {}", () => {
  assert.equal(configKey({}), "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
});

test("URL hash strips the fragment", () => {
  assert.equal(urlKeyHash("https://x.test/a#frag", "k"), urlKeyHash("https://x.test/a", "k"));
});

test("Config Key matches SEB reference value (Windows 2.2.3 config)", () => {
  const xml = fs.readFileSync(path.join(import.meta.dirname, "fixtures/unencrypted_win_223.seb"), "utf8");
  assert.equal(configKey(parsePlist(xml)), "2534e4e9f3188f9f9133bf7cf7b4c5d898292bbd7e8d0230f39d1176636a1431");
});
