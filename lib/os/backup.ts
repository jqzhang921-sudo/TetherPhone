"use client";
import { STORES, getAll, putMany, clearStore, type Row } from "@/lib/db/idb";
import { SETTINGS_KEY } from "./settings";

/// 导出 / 导入整机数据。
///
/// **这不是锦上添花的功能，是兜底。** iOS Safari 对网页写入的存储有七天上限：
/// 用户七天没打开就清掉——日记、相册、聊天记录全在本地，等于全没。
/// 加到主屏幕之后不受这条限制，但不能指望每个人都会加。
/// 所以：一个按钮，把所有东西存成一个文件。

const FORMAT = "tetherphone-backup";
const VERSION = 1;

type Dump = {
  format: typeof FORMAT;
  version: number;
  at: number;
  settings: unknown;
  stores: Record<string, unknown[]>;
};

/// 图片将来是 Blob 存在 photos 表里，JSON 装不下二进制。
/// 现在先把编解码写好，等相册做出来不用再迁一次格式。
type PackedBlob = { __blob: string; type: string };

const isBlob = (v: unknown): v is Blob =>
  typeof Blob !== "undefined" && v instanceof Blob;

const isPacked = (v: unknown): v is PackedBlob =>
  typeof v === "object" && v !== null && "__blob" in v;

async function pack(value: unknown): Promise<unknown> {
  if (isBlob(value)) {
    const buf = new Uint8Array(await value.arrayBuffer());
    let bin = "";
    // 一次性 apply 整个数组在大文件上会爆栈，分块走。
    for (let i = 0; i < buf.length; i += 8192) {
      bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    }
    return { __blob: btoa(bin), type: value.type } satisfies PackedBlob;
  }
  if (Array.isArray(value)) return Promise.all(value.map(pack));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await pack(v);
    return out;
  }
  return value;
}

function unpack(value: unknown): unknown {
  if (isPacked(value)) {
    const bin = atob(value.__blob);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: value.type });
  }
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = unpack(v);
    return out;
  }
  return value;
}

export async function exportBackup(): Promise<void> {
  const stores: Record<string, unknown[]> = {};
  for (const name of STORES) {
    stores[name] = (await pack(await getAll(name))) as unknown[];
  }

  const dump: Dump = {
    format: FORMAT,
    version: VERSION,
    at: Date.now(),
    settings: JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null"),
    stores,
  };

  const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  a.href = url;
  a.download = `tetherphone-${stamp}.json`;
  a.click();
  // 立刻 revoke 有些浏览器会把下载掐掉，给它一会儿。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ImportResult = { ok: true; counts: Record<string, number> } | { ok: false; why: string };

/// **整机覆盖，不是合并。** 合并要处理同 id 不同内容、时间线交叉、
/// 联系人重名——那是另一件事，现在做只会做出一堆看不见的冲突。
/// 所以调用方必须先跟用户确认。
export async function importBackup(file: File): Promise<ImportResult> {
  let dump: Dump;
  try {
    dump = JSON.parse(await file.text()) as Dump;
  } catch {
    return { ok: false, why: "这个文件不是合法的 JSON" };
  }
  if (dump?.format !== FORMAT) {
    return { ok: false, why: "这不像 TetherPhone 的备份文件" };
  }

  const counts: Record<string, number> = {};
  for (const name of STORES) {
    const rows = (unpack(dump.stores?.[name] ?? []) as Row[]) ?? [];
    await clearStore(name);
    await putMany(name, rows);
    counts[name] = rows.length;
  }

  if (dump.settings) {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(dump.settings));
    } catch {
      /* 设置写不回去不影响正文数据 */
    }
  }
  return { ok: true, counts };
}
