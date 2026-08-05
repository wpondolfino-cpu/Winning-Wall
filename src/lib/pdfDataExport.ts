// src/lib/pdfDataExport.ts
//
// NEEDS A NEW DEPENDENCY: `pdf-lib`. Run `npm install pdf-lib` before
// this will build. This package could not be installed/verified in the
// sandbox this was written in (no network access there) — the write
// side (embedding a file) uses a simple, well-established part of
// pdf-lib's API and should be reliable. The read side (extractJsonFromPdf)
// walks the PDF spec's embedded-file structure using pdf-lib's
// lower-level object primitives (PDFDict/PDFArray/PDFName/context.lookup)
// rather than a high-level convenience method, since none was reliably
// confirmed to exist across versions. This is the one function in this
// whole feature that genuinely needs a real round-trip test — export a
// play, then import that exact file — before trusting it further.

import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";

// The court/action styling in PlayCanvas leans on CSS custom properties
// (var(--...)) defined at :root. A serialized SVG loaded as a standalone
// image has no connection to the page's stylesheet, so anything styled
// via a CSS variable would otherwise render as nothing. This reads every
// custom property actually declared at :root and returns their resolved
// values as CSS text, to be inlined into a <style> element prepended to
// the SVG, making the isolated copy self-sufficient.
function buildRootCssVarDeclarations(): string {
  const computed = getComputedStyle(document.documentElement);
  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin stylesheet, skip
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") continue;
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        if (prop.startsWith("--")) names.add(prop);
      }
    }
  }
  return Array.from(names).map(name => `${name}: ${computed.getPropertyValue(name)};`).join(" ");
}

// Snapshots a rendered <svg> element (e.g. a play diagram) into PNG
// bytes, using only native browser APIs — no new dependency needed.
// `scale` controls resolution (2 = retina-ish sharpness for print).
export async function svgElementToPngBytes(svgEl: SVGSVGElement, widthPx: number, heightPx: number, scale = 2): Promise<Uint8Array> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const cssVars = buildRootCssVarDeclarations();
  console.log("[pdfDataExport] inlining CSS vars into snapshot, declaration count:", cssVars.split(";").length - 1);
  // Built explicitly in the SVG namespace rather than via
  // insertAdjacentHTML, which parses its argument as HTML and can
  // create the <style> element in the wrong namespace inside an SVG
  // document, causing it to be silently ignored.
  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = `:root { ${cssVars} }`;
  clone.insertBefore(styleEl, clone.firstChild);
  const svgString = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.src = svgUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Couldn't rasterize the diagram"));
    });
    console.log("[pdfDataExport] snapshot image loaded, natural size:", img.naturalWidth, "x", img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = widthPx * scale;
    canvas.height = heightPx * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG export failed")), "image/png");
    });
    console.log("[pdfDataExport] snapshot PNG size:", blob.size, "bytes");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export interface EmbeddedPayload {
  dataType: "play" | "playbook" | "scout_sheet" | "gameday_sheet" | "practice_plan";
  schemaVersion: number;
  data: any;
}

const ATTACHMENT_FILENAME = "winning-wall-data.json";

// Embeds `payload` as a hidden file attachment inside an existing PDF
// (built separately, e.g. via drawSimpleCoverPage below). Returns the
// new PDF's bytes.
export async function embedJsonInPdf(pdfBytes: Uint8Array, payload: EmbeddedPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  await doc.attach(jsonBytes, ATTACHMENT_FILENAME, {
    mimeType: "application/json",
    description: "Winning Wall re-importable data — do not edit or rename",
    creationDate: new Date(),
    modificationDate: new Date(),
  });
  return doc.save();
}

// Builds a minimal, clean PDF (title + a short notice) to carry the
// embedded data. Deliberately not a recreation of the full visual
// diagram/report — that's what the existing print/export views are
// for. This page's only job is to be a legible, honest container.
export async function drawSimpleCoverPage(title: string, subtitle: string, noticeLines: string[], stepImages?: Uint8Array[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont("Helvetica-Bold");
  const bodyFont = await doc.embedFont("Helvetica");

  const coverPage = doc.addPage([612, 792]); // US Letter
  coverPage.drawText(title, { x: 50, y: 720, size: 22, font });
  coverPage.drawText(subtitle, { x: 50, y: 695, size: 12, font: bodyFont, color: undefined });

  let y = 650;
  for (const line of noticeLines) {
    coverPage.drawText(line, { x: 50, y, size: 10, font: bodyFont });
    y -= 16;
  }

  // First step's diagram fits on the cover page itself if there's room;
  // every step gets its own page either way, so nothing is ever squeezed.
  if (stepImages && stepImages.length > 0) {
    const png = await doc.embedPng(stepImages[0]);
    const maxWidth = 512;
    const maxHeight = y - 100;
    const scale = Math.min(maxWidth / png.width, maxHeight / png.height, 1);
    const w = png.width * scale;
    const h = png.height * scale;
    coverPage.drawText(stepImages.length > 1 ? "Step 1" : "Diagram", { x: 50, y: y - 14, size: 11, font });
    coverPage.drawImage(png, { x: (612 - w) / 2, y: y - h - 30, width: w, height: h });
  }

  coverPage.drawText("Contains embedded Winning Wall data — reopen this exact file's Import option to restore it.", {
    x: 50, y: 60, size: 9, font: bodyFont,
  });

  // Remaining steps (2nd onward) each get their own full page.
  if (stepImages && stepImages.length > 1) {
    for (let i = 1; i < stepImages.length; i++) {
      const page = doc.addPage([612, 792]);
      const png = await doc.embedPng(stepImages[i]);
      page.drawText(`Step ${i + 1}`, { x: 50, y: 740, size: 16, font });
      const maxWidth = 512;
      const maxHeight = 620;
      const scale = Math.min(maxWidth / png.width, maxHeight / png.height, 1);
      const w = png.width * scale;
      const h = png.height * scale;
      page.drawImage(png, { x: (612 - w) / 2, y: 700 - h, width: w, height: h });
    }
  }

  return doc.save();
}

// Reads a PDF file the user picked and pulls the embedded payload back
// out, or returns null if this file has none (not one of ours, or
// exported before this feature existed).
export async function extractJsonFromPdf(file: File): Promise<EmbeddedPayload | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    console.log("[pdfDataExport] PDF loaded, page count:", doc.getPageCount());

    // Walk the PDF spec's embedded-file name tree directly:
    // Catalog -> /Names -> /EmbeddedFiles -> /Names [name, fileSpecRef, name, fileSpecRef, ...]
    const namesDict = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
    console.log("[pdfDataExport] catalog /Names dict found:", !!namesDict);
    if (!namesDict) return null;
    const embeddedFilesDict = namesDict.lookup(PDFName.of("EmbeddedFiles"), PDFDict);
    console.log("[pdfDataExport] /EmbeddedFiles dict found:", !!embeddedFilesDict);
    if (!embeddedFilesDict) return null;
    const namesArray = embeddedFilesDict.lookup(PDFName.of("Names"), PDFArray);
    console.log("[pdfDataExport] /EmbeddedFiles /Names array found:", !!namesArray, "size:", namesArray?.size());
    if (!namesArray) return null;

    for (let i = 0; i < namesArray.size(); i += 2) {
      const fileSpecRef = namesArray.get(i + 1);
      const fileSpec = doc.context.lookup(fileSpecRef as any, PDFDict);
      console.log(`[pdfDataExport] entry ${i}: fileSpec found:`, !!fileSpec);
      if (!fileSpec) continue;
      const efDict = fileSpec.lookup(PDFName.of("EF"), PDFDict);
      console.log(`[pdfDataExport] entry ${i}: /EF dict found:`, !!efDict);
      if (!efDict) continue;
      const fRef = efDict.get(PDFName.of("F"));
      console.log(`[pdfDataExport] entry ${i}: /F ref found:`, !!fRef);
      if (!fRef) continue;
      // The dict/array lookups above type-check fine with PDFContext.lookup's
      // overloads, but streams aren't part of that overload set the way I'd
      // assumed — looking up untyped and reading .contents at runtime instead
      // of guessing at the exact stream-lookup overload signature again.
      const stream: any = doc.context.lookup(fRef as any);
      console.log(`[pdfDataExport] entry ${i}: stream resolved:`, !!stream, "has contents:", !!stream?.contents);
      if (!stream || !stream.contents) continue;

      // Try decoding the bytes as plain text first. If that doesn't yield
      // valid JSON, the bytes are very likely still compressed (PDF
      // streams almost always are, by default) — decompress with the
      // browser's built-in support before trying again.
      const tryParse = (bytes: Uint8Array): EmbeddedPayload | null => {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          if (parsed && typeof parsed === "object" && parsed.dataType && parsed.schemaVersion != null) return parsed as EmbeddedPayload;
        } catch { /* not valid JSON at this stage */ }
        return null;
      };

      const direct = tryParse(stream.contents);
      console.log(`[pdfDataExport] entry ${i}: direct text decode produced valid JSON:`, !!direct);
      if (direct) return direct;

      try {
        const ds = new DecompressionStream("deflate");
        const decompressedStream = new Blob([stream.contents]).stream().pipeThrough(ds);
        const decompressedBytes = new Uint8Array(await new Response(decompressedStream).arrayBuffer());
        const viaDecompression = tryParse(decompressedBytes);
        console.log(`[pdfDataExport] entry ${i}: deflate-decompressed decode produced valid JSON:`, !!viaDecompression);
        if (viaDecompression) return viaDecompression;
      } catch (decompErr) {
        console.log(`[pdfDataExport] entry ${i}: deflate decompression attempt failed:`, decompErr);
      }
    }
    return null;
  } catch (e) {
    console.error("Failed to read PDF:", e);
    return null;
  }
}

// General-purpose text document layout — auto-paginates across as many
// pages as needed, since full scout sheet / game day / practice content
// can run long. Used by the three text-only exports (no diagram to
// snapshot, unlike Plays).
export async function drawTextDocument(title: string, subtitle: string, sections: { heading: string; lines: string[] }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont("Helvetica-Bold");
  const bodyFont = await doc.embedFont("Helvetica");
  const marginLeft = 50, marginTop = 742, marginBottom = 60, pageWidth = 612, pageHeight = 792;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = marginTop;

  function newPage() {
    page = doc.addPage([pageWidth, pageHeight]);
    y = marginTop;
  }
  function ensureRoom(needed: number) {
    if (y - needed < marginBottom) newPage();
  }

  page.drawText(title, { x: marginLeft, y, size: 20, font });
  y -= 22;
  page.drawText(subtitle, { x: marginLeft, y, size: 11, font: bodyFont });
  y -= 26;

  for (const section of sections) {
    ensureRoom(40);
    y -= 6;
    page.drawText(section.heading, { x: marginLeft, y, size: 13, font });
    y -= 18;
    for (const line of section.lines) {
      const maxCharsPerLine = 92;
      const wrapped: string[] = [];
      let remaining = line;
      while (remaining.length > maxCharsPerLine) {
        let cut = remaining.lastIndexOf(" ", maxCharsPerLine);
        if (cut <= 0) cut = maxCharsPerLine;
        wrapped.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).trim();
      }
      wrapped.push(remaining);
      for (const wrappedLine of wrapped) {
        ensureRoom(16);
        page.drawText(wrappedLine, { x: marginLeft, y, size: 10, font: bodyFont });
        y -= 14;
      }
    }
    y -= 8;
  }

  const lastPage = doc.getPage(doc.getPageCount() - 1);
  lastPage.drawText("Contains embedded Winning Wall data — reopen this exact file's Import option to restore it.", {
    x: marginLeft, y: 30, size: 8, font: bodyFont,
  });

  return doc.save();
}
