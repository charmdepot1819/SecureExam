/**
 * Safe Exam Browser (SEB) integration.
 *
 * - Builds an unencrypted SEB config file (Apple plist XML), as LMS integrations such as Moodle's quizaccess_seb do.
 * - Computes the SEB Config Key exactly as specified at https://safeexambrowser.org/developer/seb-config-key.html:
 *   SHA-256 over the "SEB-JSON" serialization (keys sorted case-insensitively with Unicode collation, compact JSON,
 *   no slash/unicode/backslash escaping, originatorVersion removed, empty dicts removed, data → base64, date → ISO 8601).
 * - Verifies the X-SafeExamBrowser-ConfigKeyHash / X-SafeExamBrowser-RequestHash headers and the equivalent
 *   JavaScript API values: SHA-256(absolute URL without fragment + key).
 */
import crypto from "node:crypto";

export class PReal {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
export class PDate {
  value: Date;
  constructor(value: Date) {
    this.value = value;
  }
}
export class PData {
  value: Buffer;
  constructor(value: Buffer) {
    this.value = value;
  }
}
export type PValue = string | boolean | number | PReal | PDate | PData | PValue[] | { [k: string]: PValue };

const collator = new Intl.Collator("und", { sensitivity: "variant" });

function isDict(v: PValue): v is { [k: string]: PValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof PReal) && !(v instanceof PDate) && !(v instanceof PData);
}

const BS = "\u{F8FF}\u{F8FE}\u{F8FD}\u{F8FC}"; // placeholder for backslashes during JSON encoding

function toJsonable(v: PValue): any {
  if (v instanceof PReal) return v.value;
  if (v instanceof PDate) return v.value.toISOString().replace(/\.\d{3}Z$/, "+00:00");
  if (v instanceof PData) return v.value.toString("base64");
  if (typeof v === "string") return v.replace(/\\/g, BS);
  if (Array.isArray(v)) return v.map(toJsonable);
  if (isDict(v)) {
    const out: Record<string, any> = {};
    const keys = Object.keys(v)
      .filter((k) => !(isDict(v[k]) && Object.keys(v[k] as object).length === 0))
      .sort(collator.compare);
    for (const k of keys) out[k] = toJsonable(v[k]);
    return out;
  }
  return v;
}

/** The SEB-JSON string for a config dictionary (root level). */
export function sebJson(config: { [k: string]: PValue }): string {
  const copy = { ...config };
  delete copy.originatorVersion;
  return JSON.stringify(toJsonable(copy)).split(BS).join("\\");
}

export function configKey(config: { [k: string]: PValue }): string {
  return crypto.createHash("sha256").update(sebJson(config), "utf8").digest("hex");
}

/** Hash that SEB sends: SHA-256 of the absolute request URL (fragment removed) followed by the key. */
export function urlKeyHash(url: string, key: string): string {
  const clean = url.split("#")[0];
  return crypto.createHash("sha256").update(clean + key, "utf8").digest("hex");
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistNode(v: PValue, indent: string): string {
  if (typeof v === "string") return `${indent}<string>${esc(v)}</string>`;
  if (typeof v === "boolean") return `${indent}<${v}/>`;
  if (typeof v === "number") return `${indent}<integer>${Math.trunc(v)}</integer>`;
  if (v instanceof PReal) return `${indent}<real>${v.value}</real>`;
  if (v instanceof PDate) return `${indent}<date>${v.value.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`;
  if (v instanceof PData) return `${indent}<data>${v.value.toString("base64")}</data>`;
  if (Array.isArray(v)) return `${indent}<array>\n${v.map((x) => plistNode(x, indent + "  ")).join("\n")}\n${indent}</array>`;
  const keys = Object.keys(v).sort(collator.compare);
  return `${indent}<dict>\n${keys
    .map((k) => `${indent}  <key>${esc(k)}</key>\n${plistNode((v as any)[k], indent + "  ")}`)
    .join("\n")}\n${indent}</dict>`;
}

export function toPlistXml(config: { [k: string]: PValue }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${plistNode(config, "")}
</plist>
`;
}

export type SebOptions = {
  baseUrl: string; // e.g. https://exams.example.edu
  examId: string;
  /** SHA-256 hex of the quit password (only the hash is stored and sent). */
  quitPasswordHash?: string;
  allowedHosts: string[];
};

/**
 * The config used to start an exam in SEB. Keys follow the SEB configuration key names
 * (see SEB "ConfigKeys" spec; the same keys Moodle's quizaccess_seb writes).
 */
export function buildSebConfig(o: SebOptions): { [k: string]: PValue } {
  const base = o.baseUrl.replace(/\/$/, "");
  const cfg: { [k: string]: PValue } = {
    startURL: `${base}/exams/${o.examId}/lockdown`,
    quitURL: `${base}/seb/quit`,
    quitURLConfirm: false,
    sendBrowserExamKey: true,
    browserWindowWebView: 3, // "Prefer Modern": enables the SEB JavaScript API (needed on macOS/iOS)
    examSessionClearCookiesOnStart: true,
    allowQuit: true,
    showTaskBar: true,
    showReloadButton: true,
    showTime: true,
    browserWindowAllowReload: true,
    allowSpellCheck: false,
    allowDictionaryLookup: false,
    enablePrintScreen: false,
    allowWlan: false,
    audioControlEnabled: false,
    browserMediaCaptureCamera: false,
    browserMediaCaptureMicrophone: false,
    URLFilterEnable: true,
    URLFilterEnableContentFilter: false,
    URLFilterRules: o.allowedHosts.map((h) => ({
      action: 1,
      active: true,
      expression: `${h}/*`,
      regex: false,
    })),
  };
  if (o.quitPasswordHash) cfg.hashedQuitPassword = o.quitPasswordHash;
  return cfg;
}

export const SEB_HEADERS = {
  configKey: "x-safeexambrowser-configkeyhash",
  browserExamKey: "x-safeexambrowser-requesthash",
};

export function hashQuitPassword(pw: string): string {
  return crypto.createHash("sha256").update(pw, "utf8").digest("hex");
}
