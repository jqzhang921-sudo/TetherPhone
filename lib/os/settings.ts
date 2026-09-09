"use client";

/// 全部存 localStorage。第一版没有后端，也就没有账号——
/// 这台"手机"属于这个浏览器。以后要做云端同步，这里是唯一的收口点。
export type Settings = {
  apiBase: string;
  apiKey: string;
  model: string;
  wallpaperId: string;
  userName: string;
  aiName: string;
  persona: string;
};

export const DEFAULT_SETTINGS: Settings = {
  apiBase: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  wallpaperId: "dusk",
  userName: "",
  aiName: "",
  // 刻意不写任何关系标签（"你的朋友""贴心助手"）。
  // 挂了形容词模型就去演那个词——这条是 phone-ai-assistant 里
  // 用一整轮换来的教训，别在新 App 里重犯。
  persona: "",
};

const KEY = "tether.settings.v1";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // 合并而不是整个替换：加了新字段时老数据不会把它变成 undefined。
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
