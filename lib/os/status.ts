import type { Settings } from "./settings";

/// 状态。你和它各一个，像微信的「状态」：一个词，外加一句可有可无的话，24 小时后自己消失。
///
/// ⚠️ **它的状态只能是心里的，不能是身上的。** 「开心」「有点想你」可以；
/// 「在跑步」「刚到家」不行——它没有身体、不会出门，编一个就是在骗她。
/// 这条写在工具规矩里（lib/tools.ts），这儿再记一遍。
///
/// ⚠️ **过期不用删。** 读的时候按时间判断，过了 24 小时就当没有——
/// 不然还得起一个定时器去清，而 App 关着的时候那个定时器根本不存在。
export type Status = { word: string; text?: string; at: number };

export const STATUS_TTL = 24 * 3600_000;

export const liveStatus = (s: Status | null | undefined, now = Date.now()): Status | null =>
  s && s.word.trim() && now - s.at < STATUS_TTL ? s : null;

/// 她的状态存在 settings 里（三个平铺的键，settings 是一张扁的字符串表）
export const myStatus = (s: Settings, now = Date.now()) =>
  liveStatus(s.myStatusWord ? { word: s.myStatusWord, text: s.myStatusText, at: s.myStatusAt } : null, now);

/// 她那边能直接点的几个。不求全，说得出口就行
export const MY_PRESETS = ["开心", "累", "emo", "在忙", "学习中", "想你", "发呆", "睡不着"];

/// 显示用的一行：「累 · 刚下课」
export const statusLabel = (s: Status) => (s.text?.trim() ? `${s.word} · ${s.text.trim()}` : s.word);

/// 给模型读的一句。**带上是多久前设的**——三小时前的「在忙」和刚设的「在忙」不是一回事。
export function statusLine(who: "她" | "你", s: Status | null, now = Date.now()) {
  if (!s) return "";
  const h = Math.round((now - s.at) / 3600_000);
  return `${who}现在的状态：「${s.word}」${s.text?.trim() ? s.text.trim() : ""}（${h < 1 ? "刚设的" : `${h} 小时前设的`}）`;
}
