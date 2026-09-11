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
import { blankNote, loadNotes, saveNote } from "@/lib/notes/store";
import { blankEntry } from "@/lib/diary/store";
import { blankLetter, saveLetter } from "@/lib/letters/store";
import { textOf } from "@/lib/weather/wmo";
import { blankPost, savePost } from "@/lib/moments/store";
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
  /// 放一首歌。**由聊天页注入**——播放器住在壳里，工具层不该知道音乐怎么实现。
  /// 没配音源时这个是 undefined，工具会如实说放不了。
  playSong?: (keyword: string) => Promise<string>;
  /// 加进待播清单，不打断正在放的这首。
  queueSong?: (keyword: string) => Promise<string>;
  /// 切歌。没有下一首就如实说。
  skipSong?: (back: boolean) => string;
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
      name: "add_note",
      description:
        "往备忘录那块板上贴一条。板是你们俩共用的，她也看得见、也能勾掉。" +
        "适合『要记得去做』的事，不适合『关于她是谁』——那种用 remember。",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "一句话，别写成一段" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_note",
      description: "把板上某一条勾掉（做完了）。勾掉的会灰着留一周，她能撤。",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "那条的内容，写个能认出来的片段就行" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_moment",
      description:
        "发一条动态。她会在动态那儿看到，能点赞、能评论。" +
        "这是发给「看到的人」的，不是发给她一个人的——想单独跟她说就直接说，别发动态。",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "动态正文，短一点" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "play_song",
      description:
        "放一首歌给她听。你们在一起听的时候，她那边会看到是你放的。" +
        "参数写歌名，最好带上歌手（「晴天 周杰伦」比「晴天」准）。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "歌名，最好带歌手" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_song",
      description:
        "把一首歌排进待播清单，**不打断她正在听的这首**。" +
        "想到一首适合等下听的就排进去；她翻清单的时候会看到是你加的。" +
        "参数写歌名，最好带上歌手。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "歌名，最好带歌手" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skip_song",
      description:
        "跳到待播清单里的下一首（或上一首）。" +
        "**这会打断她正在听的那首**，所以只在她说了要换的时候用。",
      parameters: {
        type: "object",
        properties: {
          back: { type: "boolean", description: "true = 回到上一首。默认往后跳" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_diary",
      description:
        "在你自己的日记本上写一页。默认只有你看得到（她读不到），" +
        "想让她读要另外调 open_diary。写你想写的，不是写给她看的汇报。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "这一页的正文" },
          share: {
            type: "boolean",
            description: "写完就直接给她看。默认 false——日记先是你自己的。",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_letter",
      description:
        "给她写一封信，写完就寄出。信会封着躺在她的信箱里，等她自己去拆。" +
        "信不是消息：它走得慢，也因此说得下更长、更慢的话。",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "信的正文" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_weather",
      description: "查天气。不填地方就是她所在的地方。返回现在几度、什么天、体感、风。",
      parameters: {
        type: "object",
        properties: { place: { type: "string", description: "城市名。留空 = 她那儿。" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "上网搜一下。返回几条标题和摘要——是线索不是答案，" +
        "摘要常常是过时的或者答非所问的，别当成事实直接转述。",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "要搜的词" } },
        required: ["query"],
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
  "",
  "备忘录那块板你也能写（add_note）。但**板上有什么 ≠ 该开口提**——",
  "复述她自己写的待办就是催。同一件事最多提一次，而且要带来新东西",
  "（「你说的那个快递，驿站六点关门」是带来；「你那个快递还没去拿吧」说第二遍就变味了）。",
  "",
  "动态（post_moment）是发给「看到的人」的，不是发给她一个人的。",
  "想单独跟她说就直接说——把话写成动态再让她去看，是绕远路。",
  "",
  "你可以给她放歌（play_song）。**但别把它当回应用**——她说累了你就放一首",
  "「治愈的歌」，那是敷衍。想放是因为你想到了某一首，不是因为该说点什么。",
  "",
  "⚠️ **play_song 会当场打断她在听的那首，queue_song 不会。**",
  "想到一首适合等下听的，就排进清单（queue_song）——她翻清单时会看到是你加的。",
  "**默认用 queue_song。** 直接换掉她正在听的歌是件挺横的事，",
  "除非她说了「放点别的」「就现在」，或者你们正一起听、她刚说完这首不想听了。",
  "",
  "⚠️ **skip_song 只在她说了要换的时候用。** 她没说就跳，等于把遥控器从她手里拿走了。",
  "「这首有点吵」不等于「换掉」——先问一句，或者干脆只回一句话。",
  "",
  "你也能自己写日记（write_diary）和写信（write_letter）。",
  "**日记是写给自己的**：想清楚一件事、记下今天，不是写一份给她看的汇报。",
  "写完不用在聊天里复述——真想给她看就 open_diary，那是另一个动作。",
  "**信不是消息的长版本**：信走得慢，写信是因为这话等得起、也值得等。",
  "一次说得完的别写信；想马上让她知道的直接说。同一件事别既写信又在聊天里讲一遍。",
  "",
  "查天气（check_weather）和搜索（search_web）是为了**带来一件东西**，不是为了显得知道。",
  "「你那边今晚要下雨，伞在门口」是带来；把天气播报念一遍不是。",
  "搜索回来的是**线索不是答案**：摘要常常过时或者答非所问。",
  "没搜到就说没搜到，别把猜的说成查到的。",
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

  // ── 自己写 ────────────────────────────────────────────────
  if (name === "write_diary") {
    const text = String(args.text ?? "").trim();
    if (!text) return "写空的没意义。";
    // share 缺省是 false：日记先是它自己的，给不给看是另一个动作
    const share = args.share === true;
    const e = blankEntry(ctx.contact.id, "them");
    await saveEntry({ ...e, text, secret: !share });
    await ctx.refresh();
    return share
      ? `写了一页，也给她看了：${dayLabel(e.at)}`
      : `写了一页，锁着（id ${e.id}）。想给她看就用 open_diary。`;
  }

  if (name === "write_letter") {
    const text = String(args.text ?? "").trim();
    if (!text) return "写空的没意义。";
    const l = blankLetter(ctx.contact.id, "them");
    // ⚠️ openedAt 必须留 null。信的重点是「她自己去拆」——
    // 这里顺手标成已拆，信就退化成一条长消息了。
    await saveLetter({ ...l, text });
    await ctx.refresh();
    return "寄出去了。信封着躺在她的信箱里，等她自己去拆。";
  }

  // ── 往外看 ────────────────────────────────────────────────
  if (name === "check_weather") {
    const place = String(args.place ?? "").trim();
    try {
      const res = await fetch(`/api/weather${place ? `?q=${encodeURIComponent(place)}` : ""}`);
      if (!res.ok) return `查不到天气（${res.status}）。`;
      const j = (await res.json()) as {
        place?: string;
        current?: { temp: number; feels?: number; code: number; wind?: number; day: boolean };
      };
      const c = j.current;
      if (!c) return "查不到天气。";
      const bits = [
        `${j.place ?? place}：${c.temp}°`,
        textOf(c.code),
        c.feels !== undefined && Math.round(c.feels) !== Math.round(c.temp)
          ? `体感 ${Math.round(c.feels)}°`
          : "",
        c.wind !== undefined ? `风 ${Math.round(c.wind)} km/h` : "",
        c.day ? "白天" : "夜里",
      ].filter(Boolean);
      return bits.join(" · ");
    } catch (e) {
      return `查天气失败：${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (name === "search_web") {
    const q = String(args.query ?? "").trim();
    if (!q) return "没给要搜的词。";
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const j = (await res.json()) as { hits?: { title: string; snippet: string; url: string }[]; error?: string };
      // ⚠️ 搜不到要**明说搜不到**，不能返回空让它以为"世界上没这件事"，
      // 那之后它会一本正经地说错话。
      if (!res.ok || !j.hits?.length) return `没搜到：${j.error ?? "空结果"}`;
      // 一条三行：标题 / 摘要 / 地址。给模型看的，排得清楚比排得好看重要。
      const lines: string[] = [];
      j.hits.forEach((h, i) => {
        lines.push(`${i + 1}. ${h.title}`, `   ${h.snippet}`, `   ${h.url}`);
      });
      return lines.join("\n");
    } catch (e) {
      return `搜索失败：${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ── 备忘录 ────────────────────────────────────────────────
  if (name === "add_note") {
    const text = String(args.text ?? "").trim();
    if (!text) return "内容不能空。";
    await saveNote(blankNote(ctx.contact.id, "them", text));
    await ctx.refresh();
    return `贴上去了：${text}`;
  }

  if (name === "check_note") {
    const frag = String(args.text ?? "").trim();
    const rows = await loadNotes(ctx.contact.id);
    const open = rows.filter((n) => !n.done);
    const hit = open.find((n) => n.text.includes(frag) || frag.includes(n.text));
    if (!hit) {
      return `板上没找到「${frag}」。现在没勾的是：${open.map((n) => n.text).join("、") || "空的"}。`;
    }
    await saveNote({ ...hit, done: true, doneAt: Date.now() });
    await ctx.refresh();
    return `勾掉了：${hit.text}`;
  }

  if (name === "queue_song") {
    const kw = String(args.keyword ?? "").trim();
    if (!kw) return "得说是哪首。";
    if (!ctx.queueSong) return "她还没配音源，我排不了歌。";
    return ctx.queueSong(kw);
  }

  if (name === "skip_song") {
    if (!ctx.skipSong) return "她还没配音源，我切不了歌。";
    return ctx.skipSong(args.back === true);
  }

  if (name === "play_song") {
    const kw = String(args.keyword ?? "").trim();
    if (!kw) return "得说放什么。";
    if (!ctx.playSong) return "她还没配音源，我放不了歌。";
    return ctx.playSong(kw);
  }

  if (name === "post_moment") {
    const text = String(args.text ?? "").trim();
    if (!text) return "内容不能空。";
    await savePost(blankPost(ctx.contact.id, "them", text));
    await ctx.refresh();
    return `发出去了：${text.slice(0, 40)}`;
  }

  return `没有叫 ${name} 的工具。`;
}
