"use client";

/// 全局设置。**只放跟"谁在跟你说话"无关的东西**——
/// 名字、人设、模型偏好都归联系人管（lib/os/contacts.ts），
/// 那是「只有一个 AI」时代的遗留，别再往这里加。
export type Settings = {
  apiBase: string;
  apiKey: string;
  /// 默认模型。联系人可以各自覆盖。
  model: string;
  wallpaperId: string;
  /// 用户自己的资料——聊天页和主页要显示
  userName: string;
  userEmoji: string;
  userSignature: string;

  /// ⚠️ 下面两个是旧版遗留，只用来在第一次启动时把老数据搬进联系人。
  /// 设置页不再编辑它们。见 contacts.ensureSeed。
  aiName?: string;
  persona?: string;
};

export const DEFAULT_SETTINGS: Settings = {
  apiBase: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  wallpaperId: "dusk",
  userName: "",
  userEmoji: "🌱",
  userSignature: "",
};

const KEY = "tether.settings.v1";

/// 设置留在 localStorage 而不是 IndexedDB，是故意的：它很小，而且壁纸要在
/// 首屏就读到——走异步的 IndexedDB 会先闪一下默认壁纸再跳成你选的那张。
export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // 合并而不是替换：加了新字段时老数据不会把它变成 undefined。
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 隐私模式 / 存储被禁：设置存不下，但这一次会话照常能用。
  }
}

export const SETTINGS_KEY = KEY;
