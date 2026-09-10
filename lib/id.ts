export const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/// 从 id 取一个稳定的数，用来挑纸色、歪多少度这类「同一个东西每次看都一样」的事。
///
/// ⚠️ **不能拿 `id.charCodeAt(0)` 凑。** id 开头是时间戳的高位，同一天里根本不变
/// ——一板便签会全是同一个颜色，一篇日记里的照片会全歪同一个方向。
/// 得把整串都吃进去（FNV-1a）。
export function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
