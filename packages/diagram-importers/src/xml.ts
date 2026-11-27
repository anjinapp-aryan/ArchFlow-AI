import { SaxesParser } from "saxes";

/**
 * Minimal, safe XML tree for draw.io files, built on `saxes` (ISC, strict well-formedness, no
 * DTD processing, no external entities, no network). DOCTYPE declarations are refused outright,
 * and size/depth/element limits bound the work an untrusted file can cause.
 */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated character data directly inside this element (trimmed). */
  text: string;
}

export interface XmlLimits {
  maxElements: number;
  maxDepth: number;
}
export const DEFAULT_XML_LIMITS: XmlLimits = { maxElements: 50_000, maxDepth: 64 };

export class XmlError extends Error {
  constructor(
    readonly code: "doctype" | "malformed" | "limit",
    message: string,
  ) {
    super(message);
  }
}

export function parseXml(text: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new XmlError("doctype", "DOCTYPE/ENTITY declarations are not accepted");
  const parser = new SaxesParser({ xmlns: false, position: true });
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let count = 0;
  let failure: Error | undefined;
  parser.on("error", (e) => {
    failure ??= e;
  });
  parser.on("doctype", () => {
    failure ??= new XmlError("doctype", "DOCTYPE declarations are not accepted");
  });
  parser.on("opentag", (tag) => {
    if (failure) return;
    if (++count > limits.maxElements) {
      failure = new XmlError("limit", `more than ${limits.maxElements} XML elements`);
      return;
    }
    if (stack.length >= limits.maxDepth) {
      failure = new XmlError("limit", `XML nesting deeper than ${limits.maxDepth}`);
      return;
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tag.attributes)) attrs[k] = String(v);
    const el: XmlElement = { name: tag.name, attrs, children: [], text: "" };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else root ??= el;
    stack.push(el);
  });
  parser.on("text", (t) => {
    const cur = stack[stack.length - 1];
    if (cur && !failure) cur.text += t;
  });
  parser.on("cdata", (t) => {
    const cur = stack[stack.length - 1];
    if (cur && !failure) cur.text += t;
  });
  parser.on("closetag", () => {
    const el = stack.pop();
    if (el) el.text = el.text.trim();
  });
  try {
    parser.write(text).close();
  } catch (e) {
    failure ??= e instanceof Error ? e : new Error(String(e));
  }
  if (failure)
    throw failure instanceof XmlError ? failure : new XmlError("malformed", failure.message);
  if (!root) throw new XmlError("malformed", "no root element");
  return root;
}

export const childrenNamed = (el: XmlElement, name: string): XmlElement[] =>
  el.children.filter((c) => c.name === name);
export const firstChild = (el: XmlElement, name: string): XmlElement | undefined =>
  el.children.find((c) => c.name === name);
