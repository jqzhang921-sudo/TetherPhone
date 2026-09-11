import { completeOnce, identity } from "@/lib/ai";
import { loadMsgs, newId, saveMsgs } from "@/lib/chat/store";
import type { Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import type { Track } from "./store";

/// 邀请某个人一起听。
///
/// ⚠️ **它可以拒绝，而且拒绝必须是真的。** 一个永远说「好呀」的邀请
/// 就不是邀请，是一个多点一下的开关——那还不如直接把开关摆出来。
/// 所以这里问的是模型，不是掷骰子，也不是「八成同意」的概率：
/// 它手上有自己的人设和最近的对话，它凭那个答。
///
/// ⚠️ **邀请和回答都落进聊天记录。** 一起听是发生在你们俩之间的事，
/// 不是音乐 app 的一个内部状态。事后翻聊天翻得到「那天她叫我听歌」，
/// 这件事才算真的发生过。（对照 music-player 里那条相反的规矩：
/// 它单方面说的闲话在没人接之前不落库——那种是自言自语，这种是来往。）
export type Answer = { yes: boolean; said: string };

const CUE = "[一起听]";

export async function invite(
  settings: Settings,
  contact: Contact,
  track: Track | null,
): Promise<Answer> {
  const what = track
    ? `《${track.title}》${track.artist ? " - " + track.artist : ""}`
    : "点歌";

  const asked = track ? `一起听${what}？` : "一起听歌吗？";
  const mine = { id: newId(), contactId: contact.id, role: "user" as const, content: asked, at: Date.now() };
  await saveMsgs([mine]);

  const recent = (await loadMsgs(contact.id))
    .filter((m) => m.role !== "event")
    .slice(-8)
    .map((m) => `${m.role === "user" ? "她" : "你"}：${m.content}`)
    .join("\n");

  let yes = true;
  let said = "";
  try {
    const out = await completeOnce(
      settings,
      contact,
      [
        ...identity(contact, settings),
        `她邀请你一起听${what}。`,
        recent ? `刚才说到：\n${recent}` : "",
        "",
        "你可以答应，也可以不。**不想听就说不想听**，别为了迁就她答应——",
        "她真正想要的是你也在，不是你配合。",
        "",
        // ⚠️ 先答案后话：模型先写一长段再表态的话，前面那段会把答案带跑。
        // 而且第一行固定，解析起来不用猜。
        "第一行只写「好」或者「不」，第二行写你要说的那一句（短，像说话）。",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const lines = out.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const head = lines[0] ?? "";
    // ⚠️ 只认第一行的表态。**「不」要先判**——「不好」「不太想」里都带着「好」，
    // 先判「好」的话，所有的拒绝都会被读成同意。
    yes = !/^(不|别|算了|下次|不用|没|拒)/.test(head);
    said = lines.slice(1).join("\n") || (yes ? "好。" : "这会儿不太想。");
  } catch {
    // 模型没答上来不代表它拒绝。**这种时候不要替它做决定**——
    // 说清楚是没问上，让她自己再点一次。
    return { yes: false, said: "" };
  }

  await saveMsgs([
    { id: newId(), contactId: contact.id, role: "assistant", content: said, at: Date.now() },
  ]);
  return { yes, said };
}

/// 一起听结束时留一句。**不问模型**——收尾不该再花一次调用，
/// 而且这一句本来就是记事，不是说话。
export async function endTogether(contact: Contact, seconds: number) {
  if (seconds < 60) return;
  const m = Math.floor(seconds / 60);
  await saveMsgs([
    {
      id: newId(),
      contactId: contact.id,
      role: "event",
      content: `${CUE} 一起听了 ${m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`}`,
      at: Date.now(),
    },
  ]);
}
