#!/usr/bin/env node
/**
 * 网易云扫码登录，把 cookie 写进 .env.local。
 *
 * 用法（音源实例要先跑起来）：
 *   node tools/music-login.mjs http://localhost:3300
 *
 * 为什么要有这个脚本、而不是在设置页里填一个框：
 *
 * cookie 等于你账号的钥匙。放进浏览器的 localStorage，它就会跟着「导出备份」
 * 跑进那个 JSON 文件；放进 URL 参数，它就会落进服务器的请求日志。
 * 所以它只该待在**服务器进程的环境变量**里——不进浏览器、不进备份、不进日志、
 * 也不进 git（.gitignore 里已经有 .env*.local）。
 *
 * 扫码登录还有一个好处：**全程不用输密码**，也不用去浏览器里翻 cookie。
 */
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] ?? "http://localhost:3300").replace(/\/+$/, "");
const ENV = resolve(ROOT, ".env.local");
const QR = resolve(ROOT, "tools", "qr.png");

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log(`音源实例：${BASE}`);
  // timestamp 是为了绕开这类接口自己的缓存，不加会拿到旧的 key
  const key = (await get(`/login/qr/key?timestamp=${Date.now()}`))?.data?.unikey;
  if (!key) throw new Error("拿不到二维码 key，确认音源实例跑起来了没");

  const created = await get(
    `/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&timestamp=${Date.now()}`,
  );
  const img = created?.data?.qrimg;
  if (!img) throw new Error("拿不到二维码图片");

  writeFileSync(QR, Buffer.from(img.split(",")[1], "base64"));
  console.log(`\n二维码已存到：${QR}`);
  console.log("打开它，用网易云 App 扫一下。（用完会自动删掉）\n");

  // 800=过期 801=等扫 802=待确认 803=成功
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > 3 * 60_000) throw new Error("三分钟没扫，超时了");
    await sleep(2500);
    const s = await get(`/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`);
    if (s.code === 801) process.stdout.write("等你扫…\r");
    else if (s.code === 802) process.stdout.write("扫到了，在手机上点确认…\r");
    else if (s.code === 800) throw new Error("二维码过期了，重跑一次");
    else if (s.code === 803) {
      const cookie = s.cookie;
      if (!cookie) throw new Error("登录成功但没拿到 cookie");

      // 只改 MUSIC_COOKIE 这一行，别把人家 .env.local 里别的东西冲掉
      const old = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
      const kept = old
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith("MUSIC_COOKIE="));
      // 值里有分号和空格，必须加引号，否则 dotenv 读到第一个分号就截断
      kept.push(`MUSIC_COOKIE="${cookie.replace(/"/g, '\\"')}"`);
      writeFileSync(ENV, kept.join("\n") + "\n");

      console.log("\n登录成功，cookie 已写进 .env.local");
      console.log("⚠️ 这个文件不要提交、不要发给别人——它等于你的账号。");
      console.log("\n**要重启 `npm run dev` 才会生效。**");
      break;
    }
  }
} catch (e) {
  console.error("\n失败：" + (e?.message ?? e));
  process.exitCode = 1;
} finally {
  if (existsSync(QR)) unlinkSync(QR);
}
