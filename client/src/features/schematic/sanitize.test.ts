import { describe, expect, it } from 'vitest';
import { isAllowedAttribute, isAllowedElement, NETLISTSVG_NS, sanitizeTree, SVG_NS, svgDimensions } from './sanitize';
import { parseXml } from './testing/fakeXml';

const HEAD = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:s="https://github.com/nturley/netlistsvg" width="580" height="296">`;

function clean(body: string) {
  const root = parseXml(HEAD + body + '</svg>');
  const report = sanitizeTree(root);
  return { root, report, names: root.all().map((e) => e.localName) };
}

describe('isAllowedElement', () => {
  it('keeps drawing elements and netlistsvg metadata', () => {
    for (const n of ['svg', 'g', 'path', 'rect', 'line', 'circle', 'text', 'tspan', 'clipPath', 'use']) {
      expect(isAllowedElement(SVG_NS, n)).toBe(true);
    }
    expect(isAllowedElement(NETLISTSVG_NS, 'alias')).toBe(true);
  });
  it('drops script, style, foreignObject, animation, image and foreign namespaces', () => {
    for (const n of ['script', 'style', 'foreignObject', 'animate', 'set', 'image', 'a', 'iframe', 'feImage']) {
      expect(isAllowedElement(SVG_NS, n)).toBe(false);
    }
    expect(isAllowedElement('http://www.w3.org/1999/xhtml', 'div')).toBe(false);
    expect(isAllowedElement(null, 'g')).toBe(false);
  });
});

describe('isAllowedAttribute', () => {
  it('drops event handlers in any case', () => {
    expect(isAllowedAttribute('onclick', 'x()')).toBe(false);
    expect(isAllowedAttribute('ONLOAD', 'x()')).toBe(false);
    expect(isAllowedAttribute('onbegin', '')).toBe(false);
  });
  it('only allows fragment hrefs', () => {
    expect(isAllowedAttribute('href', '#cell')).toBe(true);
    expect(isAllowedAttribute('xlink:href', '#a')).toBe(true);
    expect(isAllowedAttribute('href', 'javascript:alert(1)')).toBe(false);
    expect(isAllowedAttribute('xlink:href', ' java\tscript:alert(1)')).toBe(false);
    expect(isAllowedAttribute('href', 'https://evil.example/x.svg#a')).toBe(false);
    expect(isAllowedAttribute('xlink:href', 'data:image/svg+xml;base64,AAAA')).toBe(false);
  });
  it('drops javascript: and external url() anywhere', () => {
    expect(isAllowedAttribute('fill', 'url(https://evil.example/p)')).toBe(false);
    expect(isAllowedAttribute('filter', "url('//evil.example/f')")).toBe(false);
    expect(isAllowedAttribute('clip-path', 'url(#clip0)')).toBe(true);
    expect(isAllowedAttribute('marker-end', "url( '#m' )")).toBe(true);
    expect(isAllowedAttribute('style', 'background:url(http://x/y)')).toBe(false);
    expect(isAllowedAttribute('style', 'fill:#000; stroke:none')).toBe(true);
    expect(isAllowedAttribute('style', 'width:expression(alert(1))')).toBe(false);
    expect(isAllowedAttribute('values', 'javascript:alert(1)')).toBe(false);
  });
  it('keeps ordinary netlistsvg attributes with odd user-controlled names', () => {
    expect(isAllowedAttribute('id', 'cell_$design.v:6$and$4')).toBe(true);
    expect(isAllowedAttribute('class', 'net_8,9,10,11,12')).toBe(true);
    expect(isAllowedAttribute('s:type', 'inputExt')).toBe(true);
    expect(isAllowedAttribute('transform', 'translate(473,165.5)')).toBe(true);
  });
});

describe('sanitizeTree', () => {
  it('removes script/style/foreignObject subtrees and keeps the drawing', () => {
    const { names, report } = clean(`
      <style>svg { stroke: #000 }</style>
      <script>alert(1)</script>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject>
      <g s:type="and" id="cell_a"><s:alias val="$and"/><path d="M0,0" class="cell_a"/></g>
      <line x1="0" x2="1" y1="0" y2="0" class="net_4"/>`);
    expect(names).toEqual(['svg', 'g', 'alias', 'path', 'line']);
    expect(report.removedElements).toBe(3);
  });

  it('strips event handlers and dangerous links but keeps safe attributes', () => {
    const { root, report } = clean(
      `<g id="cell_x" onclick="alert(1)" onmouseover="steal()"><text x="1" onload="x" class="nodelabel">x</text>` +
        `<use xlink:href="javascript:alert(1)"/><use href="#cell_x"/></g>`,
    );
    const g = root.kids[0];
    expect(g.attrs.map((a) => a.name)).toEqual(['id']);
    expect(g.kids[0].attrs.map((a) => a.name)).toEqual(['x', 'class']);
    expect(g.kids[1].attrs).toEqual([]);
    expect(g.kids[2].getAttribute('href')).toBe('#cell_x');
    expect(report.removedAttributes).toBe(4);
  });

  it('removes animation elements that could rewrite href to javascript:', () => {
    const { names } = clean(`<a href="#x"><text>t</text></a><set attributeName="href" to="javascript:alert(1)"/><animate values="javascript:x"/>`);
    expect(names).toEqual(['svg']);
  });

  it('removes elements in a foreign namespace even with an svg-looking name', () => {
    const { names } = clean(`<h:svg xmlns:h="http://www.w3.org/1999/xhtml"/><h:script xmlns:h="http://www.w3.org/1999/xhtml">x</h:script><text>ok</text>`);
    expect(names).toEqual(['svg', 'text']);
  });

  it('keeps user-controlled text content as text (never parsed as markup)', () => {
    const { root } = clean(`<text>&lt;img src=x onerror=alert(1)&gt;</text>`);
    expect(root.kids[0].localName).toBe('text');
    expect(root.kids[0].kids).toHaveLength(0);
    expect(root.kids[0].text).toBe('<img src=x onerror=alert(1)>');
  });

  it('handles deep nesting without recursion overflow', () => {
    const depth = 20000;
    const body = '<g>'.repeat(depth) + '<script/>' + '</g>'.repeat(depth);
    // parseXml 本身是迭代的；sanitizeTree 用显式栈
    const root = parseXml(HEAD + body + '</svg>');
    const report = sanitizeTree(root);
    expect(report.removedElements).toBe(1);
  });

  it('handles an empty svg', () => {
    const { names, report } = clean('');
    expect(names).toEqual(['svg']);
    expect(report).toEqual({ removedElements: 0, removedAttributes: 0 });
  });
});

describe('svgDimensions', () => {
  it('uses width/height when present', () => {
    expect(svgDimensions('580', '296', null)).toEqual({ width: 580, height: 296, viewBox: { x: 0, y: 0, w: 580, h: 296 } });
    expect(svgDimensions('100px', '50px', null).width).toBe(100);
  });
  it('falls back to viewBox and keeps aspect ratio', () => {
    expect(svgDimensions(null, null, '0 0 400 200')).toMatchObject({ width: 400, height: 200 });
    expect(svgDimensions('800', null, '0 0 400 200')).toMatchObject({ width: 800, height: 400 });
    expect(svgDimensions('100%', '100%', '10 10 40 20')).toMatchObject({ width: 40, height: 20, viewBox: { x: 10, y: 10, w: 40, h: 20 } });
  });
  it('has a sane default when nothing is given', () => {
    expect(svgDimensions(null, null, null)).toMatchObject({ width: 300, height: 150 });
    expect(svgDimensions('abc', '-5', 'bad')).toMatchObject({ width: 300, height: 150 });
  });
});
