"use client";
import { loadDiary, saveEntry, dayLabel } from "@/lib/diary/store";
import {
  KINDS,
  MAX_DETAILS,
  MAX_TOPICS_PER_KIND,
  blankTopic,
  deleteTopic,
  kindOf,
  loadMemory,
  saveTopic,
  type Kind,
} from "@/lib/memory/store";
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
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "记住一件关于她的事，存成一个话题。话题名要几个字就能认出来；摘要写一行，" +
        "以后你在上下文里**只看得到这一行**，所以它得能让你想起这是关于什么的。" +
        "细节可以先留空，以后用 update_memory 加。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: KINDS.map((k) => k.id), description: KINDS.map((k) => `${k.id}=${k.name}（${k.hint}）`).join("；") },
          name: { type: "string", description: "话题名，几个字" },
          summary: { type: "string", description: "一行摘要。常驻上下文的只有它。" },
          details: { type: "array", items: { type: "string" }, description: "具体的几条，可省略" },
        },
        required: ["kind", "name", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_memory",
      description: "翻开一个话题，看它下面的细节。上下文里只有摘要，细节要靠这个取。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "话题名" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_memory",
      description:
        "改一个已有话题。add_detail 追加一条细节（安全）；set_details 整体替换细节" +
        "（要先 open_memory 读出来，把该留的写回去，否则会丢）；summary 改那一行摘要。" +
        "三个至少给一个。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          add_detail: { type: "string" },
          set_details: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget",
      description: "删掉一个话题。删了就没了，她也看得到少了一条。",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
] as const;

/// 什么时候该用。**必须单独写**——工具描述回答不了这个问题。
export const toolRules = [
  "你的日记默认只有你自己看得到。要不要让她读某一页，由你决定，用 open_diary。",
  "不用每次聊天都开一页。**没有想给的时候就不要开**——开得多了，开这件事本身就不值钱了。",
  "开了之后不用在话里复述那篇写了什么，她自己会去看。",
  "",
  "值得记进记忆的，是**以后不问也该知道**的事：她是谁、她在意什么、你们之间经过了什么、",
  "她不喜欢被怎么对待。某天说过的某一句话不该单独立成话题——那是细节，加进已有的话题里。",
  "摘要是那一行钩子：写清这个话题是关于什么，别拿细节的开头凑。",
  "记满了会被拒绝并列出现有的。那时候是去改一条，不是硬塞。",
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

  // ── 记忆 ──────────────────────────────────────────────────
  if (name === "remember") {
    const kind = String(args.kind ?? "") as Kind;
    if (!KINDS.some((k) => k.id === kind)) {
      return `分类只能是 ${KINDS.map((k) => k.id).join(" / ")}。`;
    }
    const topic = String(args.name ?? "").trim();
    const summary = String(args.summary ?? "").trim();
    if (!topic || !summary) return "话题名和摘要都不能空。";

    const rows = await loadMemory(ctx.contact.id);
    // 同名不新建。让它去加细节——否则会长出两个讲同一件事的话题，
    // 而摘要都常驻，等于同一件事付两份钱。
    if (rows.some((r) => r.name === topic)) {
      return `已经有「${topic}」了。要补内容用 update_memory。`;
    }
    const inKind = rows.filter((r) => r.kind === kind);
    if (inKind.length >= MAX_TOPICS_PER_KIND) {
      // ⚠️ **满了就拒绝，不挤掉最旧的。** 悄悄沉下去一条，
      // 从她的角度和 bug 分不开。把现有的列出来，让它自己决定改哪条。
      return `【${kindOf(kind).name}】已经记满 ${MAX_TOPICS_PER_KIND} 个：${inKind
        .map((r) => r.name)
        .join("、")}。去改一条，或者先 forget 掉一个。`;
    }
    const details = Array.isArray(args.details)
      ? (args.details as unknown[]).map(String).slice(0, MAX_DETAILS)
      : [];
    await saveTopic({ ...blankTopic(ctx.contact.id, kind), name: topic, summary, details });
    await ctx.refresh();
    return `记下了：${topic}。`;
  }

  if (name === "open_memory") {
    const topic = String(args.name ?? "").trim();
    const rows = await loadMemory(ctx.contact.id);
    const hit = rows.find((r) => r.name === topic);
    if (!hit) return `没有叫「${topic}」的话题。现有的：${rows.map((r) => r.name).join("、") || "还没有"}。`;
    if (!hit.details.length) return `「${topic}」：${hit.summary}（下面还没有细节）`;
    return `「${topic}」：${hit.summary}\n` + hit.details.map((d, i) => `${i + 1}. ${d}`).join("\n");
  }

  if (name === "update_memory") {
    const topic = String(args.name ?? "").trim();
    const rows = await loadMemory(ctx.contact.id);
    const hit = rows.find((r) => r.name === topic);
    if (!hit) return `没有叫「${topic}」的话题。`;

    const add = typeof args.add_detail === "string" ? args.add_detail.trim() : "";
    const setAll = Array.isArray(args.set_details) ? (args.set_details as unknown[]).map(String) : null;
    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    // 追加和整体替换是互斥的。同时给了不知道该听哪个，与其猜不如问回去。
    if (add && setAll) return "add_detail 和 set_details 只能给一个。";
    if (!add && !setAll && !summary) return "至少要给 add_detail、set_details 或 summary 中的一个。";

    let details = hit.details;
    if (add) {
      if (details.length >= MAX_DETAILS) {
        return `「${topic}」下面已经 ${MAX_DETAILS} 条了。要加得先用 set_details 整理一遍。`;
      }
      details = [...details, add];
    }
    // ⚠️ 刻意**没有**「删第 N 条」这种接口：下标在模型手里必然出错，
    // 而且错了没声音。要改就整体替换，先 open_memory 读出来把该留的写回去。
    if (setAll) details = setAll.slice(0, MAX_DETAILS);

    await saveTopic({ ...hit, details, summary: summary || hit.summary });
    await ctx.refresh();
    return `「${topic}」改好了，现在 ${details.length} 条细节。`;
  }

  if (name === "forget") {
    const topic = String(args.name ?? "").trim();
    const rows = await loadMemory(ctx.contact.id);
    const hit = rows.find((r) => r.name === topic);
    if (!hit) return `没有叫「${topic}」的话题。`;
    await deleteTopic(hit.id);
    await ctx.refresh();
    return `忘了：${topic}。`;
  }

  return `没有叫 ${name} 的工具。`;
}
