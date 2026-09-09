/** @type {import('next').NextConfig} */
const nextConfig = {
  // 手机浏览器要能从局域网开，dev 脚本已经 -H 0.0.0.0。
  // 这里留空是故意的：先不加任何构建期魔法，坏了才好定位是谁坏的。
};
export default nextConfig;
