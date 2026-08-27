import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicDir = path.join(project, "public");
const iconsDir = path.join(publicDir, "icons");
await mkdir(iconsDir, { recursive: true });
const icon = await readFile(path.join(publicDir, "icon.svg"));
await Promise.all([
  sharp(icon).resize(192).png().toFile(path.join(iconsDir, "icon-192.png")),
  sharp(icon).resize(512).png().toFile(path.join(iconsDir, "icon-512.png")),
  sharp(icon)
    .resize(180)
    .png()
    .toFile(path.join(iconsDir, "apple-touch-icon.png")),
  sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#e9efe4"/><circle cx="256" cy="256" r="127" fill="none" stroke="#405b43" stroke-width="9"/><circle cx="346" cy="166" r="28" fill="#e9efe4"/><circle cx="346" cy="166" r="16" fill="#405b43"/></svg>',
    ),
  )
    .png()
    .toFile(path.join(iconsDir, "maskable-512.png")),
]);

const favicon = await sharp(icon).resize(32).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 32;
header[7] = 32;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(favicon.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(
  path.join(publicDir, "favicon.ico"),
  Buffer.concat([header, favicon]),
);

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f7f8f5"/>
  <circle cx="83" cy="77" r="16" fill="none" stroke="#405b43" stroke-width="2"/>
  <circle cx="95" cy="65" r="6" fill="#f7f8f5"/><circle cx="95" cy="65" r="3.5" fill="#405b43"/>
  <text x="119" y="85" font-family="Yu Gothic, Meiryo, sans-serif" font-size="22" font-weight="600" fill="#29342c">何もしない記録</text>
  <text x="74" y="201" font-family="Segoe UI, Arial, sans-serif" font-size="12" letter-spacing="3" fill="#616c63">THE ART OF DOING NOTHING</text>
  <text x="70" y="299" font-family="Yu Gothic, Meiryo, sans-serif" font-size="66" font-weight="600" letter-spacing="-3" fill="#29342c">何もしないを、</text>
  <text x="70" y="389" font-family="Yu Gothic, Meiryo, sans-serif" font-size="66" font-weight="600" letter-spacing="-3" fill="#29342c">ちゃんとしよう。</text>
  <text x="75" y="449" font-family="Yu Gothic, Meiryo, sans-serif" font-size="18" fill="#616c63">何もしない時間を、ちゃんと記録する。</text>
  <circle cx="925" cy="308" r="182" fill="none" stroke="#dce3d6" stroke-width="1.5"/>
  <circle cx="925" cy="126" r="12" fill="#f7f8f5"/><circle cx="925" cy="126" r="6" fill="#405b43"/>
  <text x="925" y="331" text-anchor="middle" font-family="Segoe UI Light, Segoe UI, Arial, sans-serif" font-size="94" font-weight="200" letter-spacing="-5" fill="#29342c">00:00</text>
  <text x="925" y="373" text-anchor="middle" font-family="Yu Gothic, Meiryo, sans-serif" font-size="12" fill="#737d73">ここから、余白の時間。</text>
  <line x1="75" x2="1125" y1="549" y2="549" stroke="#e0e5dc"/>
  <text x="75" y="584" font-family="Segoe UI, Arial, sans-serif" font-size="12" letter-spacing="1" fill="#737d73">doing-nothing-timer.vercel.app</text>
  <text x="1125" y="584" text-anchor="end" font-family="Yu Gothic, Meiryo, sans-serif" font-size="12" fill="#737d73">生産性を、少しだけお休み。</text>
</svg>`;
await sharp(Buffer.from(og)).png().toFile(path.join(publicDir, "og.png"));
console.log(
  "Generated PWA icons (192/512/maskable/apple), favicon.ico and og.png.",
);
