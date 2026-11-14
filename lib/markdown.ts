import { createElement, Fragment } from "react";
import type { ReactNode } from "react";
import Image from "next/image";

// ponytail: renderer Markdown propio y acotado (headings, párrafos, listas, citas, código, hr, imágenes, links, énfasis).
// Seguro por construcción: produce elementos React (todo texto se escapa), nunca HTML crudo. Si hacen falta tablas o
// footnotes, pasar a react-markdown (pedir instalación).

export type MarkdownHeading = { id: string; text: string; level: 2 | 3 };

const h = createElement;

function headingId(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "section";
}

/** Solo http(s), mailto, rutas relativas al sitio y anclas. Bloquea javascript:, data:, etc. */
function safeHref(url: string) {
  const value = url.trim();
  if (/^(https?:|mailto:)/i.test(value) || /^\/(?!\/)/.test(value) || value.startsWith("#")) return value;
  return null;
}

function safeSrc(url: string) {
  const value = url.trim();
  return /^https:\/\//i.test(value) || /^http:\/\/localhost/i.test(value) || /^\/(?!\/)/.test(value) ? value : null;
}

const inlinePattern = /(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    const [, code, imgAlt, imgSrc, linkText, linkHref, bold1, bold2, em1, em2] = match;
    if (code) nodes.push(h("code", { key }, code.slice(1, -1)));
    else if (imgSrc !== undefined) {
      const src = safeSrc(imgSrc);
      nodes.push(src ? h(Image, { key, src, alt: imgAlt ?? "", width: 1200, height: 675, unoptimized: true, style: { width: "100%", height: "auto" } }) : imgAlt ?? "");
    } else if (linkText !== undefined) {
      const href = safeHref(linkHref ?? "");
      const external = href ? /^https?:/i.test(href) : false;
      nodes.push(href ? h("a", { key, href, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, inline(linkText, key)) : linkText);
    } else if (bold1 ?? bold2) nodes.push(h("strong", { key }, inline((bold1 ?? bold2)!, key)));
    else if (em1 ?? em2) nodes.push(h("em", { key }, inline((em1 ?? em2)!, key)));
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" }
  | { type: "image"; alt: string; src: string };

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```\s*([\w-]*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: "hr" }); i++; continue; }
    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (image) { blocks.push({ type: "image", alt: image[1], src: image[2] }); i++; continue; }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    const listMatch = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (item && /\d/.test(item[1]) === ordered) { items.push(item[2]); i++; }
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; }
        else break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const body: string[] = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) body.push(lines[i++].trim());
    blocks.push({ type: "paragraph", text: body.join(" ") });
  }
  return blocks;
}

/** Headings H2/H3 con los mismos ids que usa renderMarkdown (para la tabla de contenidos). */
export function extractHeadings(markdown: string): MarkdownHeading[] {
  const seen = new Map<string, number>();
  return parse(markdown).flatMap((block) => {
    if (block.type !== "heading" || (block.level !== 2 && block.level !== 3)) return [];
    return [{ id: uniqueId(block.text, seen), text: block.text.replace(/[*_`]/g, ""), level: block.level as 2 | 3 }];
  });
}

function uniqueId(text: string, seen: Map<string, number>) {
  const base = headingId(text.replace(/[*_`]/g, ""));
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

/** Renderiza Markdown a elementos React. Sirve en Server y Client Components (preview del admin). */
export function renderMarkdown(markdown: string): ReactNode {
  const seen = new Map<string, number>();
  return h(Fragment, null, ...parse(markdown).map((block, index) => {
    const key = `b${index}`;
    switch (block.type) {
      case "heading": {
        // El H1 es el título del post: los # del cuerpo bajan a H2 para no romper la jerarquía.
        const level = Math.max(2, block.level);
        return h(`h${level}`, { key, id: level <= 3 ? uniqueId(block.text, seen) : undefined }, inline(block.text, key));
      }
      case "paragraph": return h("p", { key }, inline(block.text, key));
      case "list": return h(block.ordered ? "ol" : "ul", { key }, block.items.map((item, itemIndex) => h("li", { key: `${key}-${itemIndex}` }, inline(item, `${key}-${itemIndex}`))));
      case "quote": return h("blockquote", { key }, h("p", null, inline(block.text, key)));
      case "code": return h("pre", { key }, h("code", { "data-lang": block.lang || undefined }, block.text));
      case "hr": return h("hr", { key });
      case "image": {
        const src = safeSrc(block.src);
        return src ? h("figure", { key }, h(Image, { src, alt: block.alt, width: 1200, height: 675, unoptimized: true, style: { width: "100%", height: "auto" } }), block.alt ? h("figcaption", null, block.alt) : null) : null;
      }
    }
  }));
}
