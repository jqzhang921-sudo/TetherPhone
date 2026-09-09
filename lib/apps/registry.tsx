import type { ReactNode } from "react";

/// 一个 app = 桌面上一个入口。`ready` 为 false 的会打开一个空态页，
/// 明说"还没做"——**不做假的假界面**：假界面会让人分不清是没做还是坏了。
export type AppDef = {
  id: string;
  name: string;
  icon: ReactNode;
  /// 图标底色。用 oklch 写，跨色相时观感才对得上（HSL 不行）。
  tint: string;
  dock?: boolean;
  ready?: boolean;
  /// app 自己画标题栏。聊天要在标题的位置放返回键和对方的头像，
  /// 用不了统一那条「大标题 = app 名」。
  ownHeader?: boolean;
};

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
    {children}
  </svg>
);

export const APPS: AppDef[] = [
  {
    id: "chat",
    name: "聊天",
    tint: "oklch(0.72 0.15 250)",
    dock: true,
    ready: true,
    ownHeader: true,
    icon: <Icon><path d="M20 12a8 8 0 1 1-3.2-6.4" /><path d="M21 4v5h-5" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" /></Icon>,
  },
  {
    id: "moments",
    name: "动态",
    tint: "oklch(0.74 0.15 30)",
    dock: true,
    icon: <Icon><circle cx="12" cy="12" r="3.2" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></Icon>,
  },
  {
    id: "photos",
    name: "相册",
    tint: "oklch(0.76 0.13 150)",
    dock: true,
    icon: <Icon><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="8.5" cy="10" r="1.5" /><path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L20 21" /></Icon>,
  },
  {
    id: "settings",
    name: "设置",
    tint: "oklch(0.68 0.02 260)",
    dock: true,
    ready: true,
    icon: <Icon><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" /></Icon>,
  },
  {
    id: "diary",
    name: "日记",
    tint: "oklch(0.75 0.11 85)",
    ready: true,
    icon: <Icon><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17h11" /><path d="M9 8h6M9 11h4" /></Icon>,
  },
  {
    id: "letters",
    name: "信",
    tint: "oklch(0.78 0.10 55)",
    ready: true,
    icon: <Icon><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M3.5 7.5l7.6 5.4a1.6 1.6 0 0 0 1.8 0l7.6-5.4" /></Icon>,
  },
  {
    id: "memory",
    name: "记忆",
    tint: "oklch(0.72 0.13 300)",
    icon: <Icon><path d="M12 4.5a4 4 0 0 0-4 4v.4A3.2 3.2 0 0 0 6.4 15v.3A3.2 3.2 0 0 0 12 17.6z" /><path d="M12 4.5a4 4 0 0 1 4 4v.4A3.2 3.2 0 0 1 17.6 15v.3A3.2 3.2 0 0 1 12 17.6z" /><path d="M12 17.6V20" /></Icon>,
  },
  {
    id: "persona",
    name: "人设",
    tint: "oklch(0.74 0.12 340)",
    icon: <Icon><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></Icon>,
  },
  {
    id: "contacts",
    name: "通讯录",
    tint: "oklch(0.73 0.11 200)",
    ready: true,
    icon: <Icon><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M3 8h2M3 12h2M3 16h2" /><circle cx="12" cy="10" r="2.2" /><path d="M8.6 16.5a3.6 3.6 0 0 1 6.8 0" /></Icon>,
  },
  {
    id: "notes",
    name: "备忘录",
    tint: "oklch(0.80 0.12 95)",
    icon: <Icon><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h6M9 16h4" /></Icon>,
  },
  {
    id: "music",
    name: "音乐",
    tint: "oklch(0.70 0.14 350)",
    icon: <Icon><path d="M9 17V5l10-2v12" /><circle cx="6.5" cy="17.5" r="2.6" /><circle cx="16.5" cy="15.5" r="2.6" /></Icon>,
  },
  {
    id: "weather",
    name: "天气",
    tint: "oklch(0.77 0.11 220)",
    icon: <Icon><path d="M7.5 18h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2A3.6 3.6 0 0 0 7.5 18z" /></Icon>,
  },
];

export const dockApps = APPS.filter((a) => a.dock);
export const gridApps = APPS.filter((a) => !a.dock);
export const appById = (id: string) => APPS.find((a) => a.id === id);
