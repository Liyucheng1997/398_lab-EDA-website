// 原理图导出：独立 SVG（白底黑线，内嵌样式）与 2× PNG。
import { exportCanvasSize } from './geometry';

/** 与 netlistsvg 默认皮肤一致的打印样式（导出文件脱离页面 CSS 后仍可读） */
export const EXPORT_CSS = `
svg { stroke: #000; fill: none; }
text { fill: #000; stroke: none; font-size: 10px; font-weight: bold; font-family: "Courier New", monospace; }
.nodelabel { text-anchor: middle; }
.inputPortLabel { text-anchor: end; }
.splitjoinBody { fill: #000; }
`;

const OWN_CLASS = /^sch-/;

/** 由页面上已挂载的（已清洗）SVG 生成可独立打开的 SVG 文本；不包含高亮等界面状态 */
export function buildExportSvg(mounted: SVGSVGElement, width: number, height: number): string {
  const clone = mounted.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('style');
  clone.removeAttribute('class');
  clone.removeAttribute('role');
  clone.removeAttribute('aria-label');
  clone.setAttribute('width', String(Math.ceil(width)));
  clone.setAttribute('height', String(Math.ceil(height)));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  for (const el of Array.from(clone.querySelectorAll('[class]'))) {
    const cls = el.getAttribute('class') ?? '';
    if (!cls.includes('sch-')) continue;
    const kept = cls.split(/\s+/).filter((c) => c && !OWN_CLASS.test(c));
    if (kept.length) el.setAttribute('class', kept.join(' '));
    else el.removeAttribute('class');
  }
  const ns = 'http://www.w3.org/2000/svg';
  const style = document.createElementNS(ns, 'style');
  style.textContent = EXPORT_CSS;
  const vb = clone.viewBox?.baseVal;
  const bg = document.createElementNS(ns, 'rect');
  if (vb && vb.width > 0 && vb.height > 0) {
    bg.setAttribute('x', String(vb.x));
    bg.setAttribute('y', String(vb.y));
    bg.setAttribute('width', String(vb.width));
    bg.setAttribute('height', String(vb.height));
  } else {
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
  }
  bg.setAttribute('style', 'fill:#fff;stroke:none');
  clone.insertBefore(bg, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 把 SVG 文本栅格化为 PNG（默认 2×，超出浏览器画布上限时自动降低倍率） */
export function svgToPng(svgText: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const size = exportCanvasSize(width, height, scale);
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('浏览器不支持 Canvas 2D');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(img, 0, 0, size.width, size.height);
        canvas.toBlob((b) => {
          URL.revokeObjectURL(url);
          if (b) resolve(b);
          else reject(new Error('PNG 编码失败（图像可能过大）'));
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG 栅格化失败'));
    };
    img.src = url;
  });
}
