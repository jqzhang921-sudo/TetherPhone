"use client";

/// 震一下。
///
/// ⚠️ **两个平台是两条完全不同的路。**
/// - 安卓 Chrome：`navigator.vibrate(ms)`，标准接口。
/// - iPhone Safari：**根本没有 vibrate**——写了不报错，就是不震。iOS 18 起，
///   `<input type="checkbox" switch>` 被点动时系统会给一下触感，所以在点击事件里
///   去点一个藏起来的这种开关。这是借系统开关的触感，不是正式接口，
///   **苹果哪天改了就没了**，没了也只是不震，不会出错。
///
/// ⚠️ **只在手指点下去的那一刻有用。** 两条路都要求「用户手势」：
/// 放进 setTimeout / 网络回调里调，iPhone 上一定不震，安卓也可能不震。
/// 不支持的设备上什么都不做——震动是锦上添花，不能变成报错。
export function haptic(kind: "light" | "medium" = "light") {
  if (typeof window === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(kind === "light" ? 12 : 24);
      return;
    }
  } catch {
    /* 有的内嵌浏览器调 vibrate 会抛，照样当不支持 */
  }
  iosTick();
}

let label: HTMLLabelElement | null = null;

function iosTick() {
  // 只有 iPhone / iPad 的 WebKit 才走这条。iPad 的 UA 会伪装成 Mac，靠触点数认出来
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (!ios) return;
  try {
    if (!label) {
      label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
    }
    label.click();
  } catch {
    /* 同上：震不了就算了 */
  }
}
