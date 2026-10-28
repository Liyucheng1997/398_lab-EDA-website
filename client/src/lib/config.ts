/**
 * 部署配置（构建时由环境变量注入）：
 * - VITE_BASE：前端部署的子路径，如 GitHub Pages 的 "/398_lab-EDA-website/"；本地开发为 "/"
 * - VITE_API_BASE：后端地址，如 "https://eda.example.com"；为空时与前端同源（本地开发经 Vite 代理）
 */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');

/** 把 "/api/..." 路径拼成实际请求地址 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** 前端路由的 basename（去掉末尾斜杠；根路径时为空串） */
export const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** 站内页面的绝对地址，如分享链接 */
export function pageUrl(path: string): string {
  return `${window.location.origin}${ROUTER_BASENAME}${path}`;
}
