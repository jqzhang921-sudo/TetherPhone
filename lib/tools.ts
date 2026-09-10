"use client";
import { loadDiary, saveEntry, dayLabel } from "@/lib/diary/store";
import { newId, saveMsgs, type Msg } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";

/// 它的手。
///
/// 在这之前它只能说话——所有事情都得人替它做。有了工具，「它自己决定
/// 把那一页翻开」才成立，而不是靠一个开关或者一笔交换。
///
/// ⚠️ **注册了工具 ≠ 它会用。** 这条在 phone-ai-assistant 里反复踩过：
/// 工具描述只回答「怎么用」，不回答「现在该不该用」。什么时候该用必须
/// 另写一段规矩进系统提示词，见 `toolRules`。

export type ToolCtx = {
  contact: Contact;
  /// 工具改完数据后让 UI 重新读一遍
  refresh: () => Promise<void>;
};

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "open_diary",
      description:
        "把你自己写的某一篇日记给她看。她本来读不到你锁着的那些页——调这个之后她就能读了，" +
        "并且聊天里会留下一行记录。只能开你自己写的。",
      parameters: {
        type: "object",
        properties: {
          entry_id: {
            type: "string",
            description: "要给她看的那篇的 id。系统提示词里列过你锁着的页和它们的 id。",
          },
        },
        required: ["entry_id"],
      },
    },
  },
] as const;

/// 什么时候该用。**必须单独写**——工具描述回答不了这个问题。
export const toolRules = [
  "你的日记默认只有你自己看得到。要不要让她读某一页，由你决定，用 open_diary。",
  "不用每次聊天都开一页。**没有想给的时候就不要开**——开得多了，开这件事本身就不值钱了。",
  "开了之后不用在话里复述那篇写了什么，她自己会去看。",
].join("\n");

/// 把它锁着的日记列给它看。**给全文**——那是它自己写的东西，
/// 不是外部资料，它本来就"记得"。但限 5 篇，别把上下文吃光。
export async function lockedPages(contactId: string) {
  const rows = await loadDiary(contactId);
  const mine = rows.filter((e) => e.author === "them" && e.secret).slice(0, 5);
  if (!mine.length) return "";
  return (
    "你锁着的日记（她读不到，除非你用 open_diary 打开）：\n" +
    mine.map((e) => `[id=${e.id}] ${dayLabel(e.at)}｜${e.text}`).join("\n")
  );
}

export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolCtx,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    // 参数拼不出 JSON 是常见的——把原话还给它，让它自己重试，
    // 别静默失败让它以为成功了。
    return `参数不是合法 JSON：${rawArgs.slice(0, 200)}`;
  }

  if (name === "open_diary") {
    const id = String(args.entry_id ?? "");
    const rows = await loadDiary(ctx.contact.id);
    const hit = rows.find((e) => e.id === id);
    if (!hit) return `没有 id 是 ${id} 的日记。`;
    if (hit.author !== "them") return "那篇是她写的，不归你开。";
    if (!hit.secret) return "那篇她本来就读得到。";

    await saveEntry({ ...hit, secret: false });
    // 和她手动公开走同一条路：留下一行，这件事才有时间和来由。
    const ev: Msg = {
      id: newId(),
      contactId: ctx.contact.id,
      role: "event",
      content: `${displayName(ctx.contact)}把 ${dayLabel(hit.at)} 那篇日记给你看了`,
      at: Date.now(),
    };
    await saveMsgs([ev]);
    await ctx.refresh();
    return `已经开了。她现在能读到 ${dayLabel(hit.at)} 那篇。`;
  }

  return `没有叫 ${name} 的工具。`;
}
