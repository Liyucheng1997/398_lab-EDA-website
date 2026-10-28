// 仅供测试：极简 XML 解析器 + 假 DOM 节点（vitest 运行在 node 环境，没有 DOMParser）。
// 只覆盖测试需要的子集：元素、属性、文本、注释、处理指令、命名空间前缀。
import type { SanitizeElement } from '../sanitize';

export class FakeElement implements SanitizeElement {
  readonly localName: string;
  readonly prefix: string | null;
  namespaceURI: string | null = null;
  readonly attrs: { name: string; value: string }[] = [];
  readonly kids: FakeElement[] = [];
  text = '';
  parent: FakeElement | null = null;

  constructor(qname: string) {
    const i = qname.indexOf(':');
    this.prefix = i >= 0 ? qname.slice(0, i) : null;
    this.localName = i >= 0 ? qname.slice(i + 1) : qname;
  }
  get attributes() {
    return this.attrs;
  }
  get children() {
    return this.kids;
  }
  getAttribute(name: string): string | null {
    return this.attrs.find((a) => a.name === name)?.value ?? null;
  }
  removeAttribute(name: string) {
    const i = this.attrs.findIndex((a) => a.name === name);
    if (i >= 0) this.attrs.splice(i, 1);
  }
  remove() {
    if (!this.parent) return;
    const i = this.parent.kids.indexOf(this);
    if (i >= 0) this.parent.kids.splice(i, 1);
    this.parent = null;
  }
  /** 深度优先列出所有后代（含自身） */
  all(): FakeElement[] {
    const out: FakeElement[] = [this];
    for (const k of this.kids) out.push(...k.all());
    return out;
  }
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

export function parseXml(src: string): FakeElement {
  const root = new FakeElement('#document');
  const stack: { el: FakeElement; ns: Map<string, string> }[] = [{ el: root, ns: new Map() }];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i);
      i = e < 0 ? src.length : e + 3;
    } else if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i);
      i = e < 0 ? src.length : e + 2;
    } else if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i);
      stack[stack.length - 1].el.text += src.slice(i + 9, e);
      i = e + 3;
    } else if (src.startsWith('</', i)) {
      const e = src.indexOf('>', i);
      stack.pop();
      i = e + 1;
    } else if (src[i] === '<') {
      const tagRe = /<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
      tagRe.lastIndex = i;
      const m = tagRe.exec(src);
      if (!m) throw new Error('bad xml at ' + i + ': ' + src.slice(i, i + 40));
      const el = new FakeElement(m[1]);
      const parentNs = stack[stack.length - 1].ns;
      const ns = new Map(parentNs);
      const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(m[2]))) {
        const name = a[1];
        const value = decode(a[2] ?? a[3] ?? '');
        if (name === 'xmlns') ns.set('', value);
        else if (name.startsWith('xmlns:')) ns.set(name.slice(6), value);
        el.attrs.push({ name, value });
      }
      el.namespaceURI = ns.get(el.prefix ?? '') ?? null;
      const parent = stack[stack.length - 1].el;
      el.parent = parent;
      parent.kids.push(el);
      if (!m[3]) stack.push({ el, ns });
      i = tagRe.lastIndex;
    } else {
      const e = src.indexOf('<', i);
      const end = e < 0 ? src.length : e;
      stack[stack.length - 1].el.text += decode(src.slice(i, end));
      i = end;
    }
  }
  const top = root.kids[0];
  if (!top) throw new Error('empty xml');
  top.parent = root;
  return top;
}
