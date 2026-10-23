import { describe, it, expect } from "vitest";
import vm from "node:vm";
import core from "../services/viewer/core.js?raw";
import highlight from "../services/viewer/highlight.js?raw";
import markdown from "../services/viewer/markdown.js?raw";
import formats from "../services/viewer/formats.js?raw";
import video from "../services/viewer/video.js?raw";
import { VIEWER_JS } from "../services/viewer";

// The viewer modules are plain browser scripts; run them in a sandbox with a minimal window.
function load(sources: string[]): any {
  const win: any = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 1000, CSS: {},
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
  };
  win.window = win;
  win.document = { addEventListener() {}, createElement: () => ({}), readyState: "complete", pictureInPictureEnabled: false };
  win.console = console; win.TextDecoder = TextDecoder; win.URL = URL; win.Blob = Blob; win.Intl = Intl;
  const ctx = vm.createContext(win);
  for (const s of sources) vm.runInContext(s, ctx);
  return win;
}

describe("viewer runtime bundle", () => {
  it("never contains a raw closing script tag (would break the inlined <script>)", () => {
    expect(VIEWER_JS.toLowerCase()).not.toContain("</script");
  });
});

describe("file typing", () => {
  const PV = load([core]).PV;
  it("classifies by extension first, then MIME", () => {
    expect(PV.kindOf({ name: "a.md", type: "" })).toBe("md");
    expect(PV.kindOf({ name: "app.ts", type: "video/mp2t" })).toBe("code");
    expect(PV.kindOf({ name: "x.mp3", type: "" })).toBe("audio");
    expect(PV.kindOf({ name: "x.bin", type: "image/png" })).toBe("image");
    expect(PV.kindOf({ name: "Makefile", type: "" })).toBe("code");
    expect(PV.kindOf({ name: "mystery.xyz", type: "application/octet-stream" })).toBe("unknown");
  });
  it("detects text encodings", () => {
    expect(PV.decode(new Uint8Array([0x43, 0x61, 0x66, 0xe9]).buffer).encoding).toBe("windows-1252");
    expect(PV.decode(new TextEncoder().encode("héllo").buffer).encoding).toBe("utf-8");
  });
});

describe("syntax highlighter", () => {
  const PV = load([core, highlight]).PV;
  it("keeps line count and escapes HTML", () => {
    const lines = PV.hl.lines("const a = '<b>';\nlet b = 2;", "js");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("&lt;b&gt;");
    expect(lines[0]).not.toContain("<b>");
  });
  it("handles multi-line block comments", () => {
    const lines = PV.hl.lines("/* a\n b */ int x;", "c");
    expect(lines[0]).toContain("t-c");
    expect(lines[1]).toContain("t-c");
  });
});

describe("markdown", () => {
  const PV = load([core, highlight, markdown]).PV;
  it("renders headings, tables and task lists", () => {
    const r = PV.md.render("# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done");
    expect(r.html).toContain("<h1");
    expect(r.html).toContain("<table>");
    expect(r.html).toContain("checked");
    expect(r.toc[0].text).toBe("T");
  });
  it("is XSS-safe", () => {
    const r = PV.md.render("<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>");
    expect(r.html).not.toContain("<script");
    expect(r.html).not.toContain("javascript:");
    expect(r.html).not.toContain("onerror");
  });
  it("blocks remote images until tapped", () => {
    expect(PV.md.render("![x](https://example.com/a.png)").html).toContain("pv-md-remote");
  });
});

describe("csv + subtitles", () => {
  const w = load([core, highlight, markdown, formats, video]);
  it("parses quoted fields with commas and newlines", () => {
    expect(w.PV.fmt.parseCSV('a,"b, ""q""",c\n1,"x\ny",3', ",")).toEqual([["a", 'b, "q"', "c"], ["1", "x\ny", "3"]]);
  });
  it("detects delimiters", () => {
    expect(w.PV.fmt.detectDelim("a;b;c\n1;2;3", "x.csv")).toBe(";");
  });
  it("parses SRT and VTT cues", () => {
    const cues = w.PV.subs.parse("1\n00:00:01,000 --> 00:00:02,500\nHello <i>x</i>\n\n2\n00:01:00.000 --> 00:01:01.000\nBye");
    expect(cues.length).toBe(2);
    expect(cues[0].s).toBe(1);
    expect(cues[0].e).toBe(2.5);
    expect(cues[0].h).toContain("<i>x</i>");
    expect(cues[1].s).toBe(60);
  });
});
