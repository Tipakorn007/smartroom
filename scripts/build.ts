import { copyFile, mkdir } from "node:fs/promises";

const result = await Bun.build({
  entrypoints: ["./src/client/main.ts"],
  outdir: "./public",
  target: "browser",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("สร้าง client bundle ไม่สำเร็จ");
}

await mkdir("./public", { recursive: true });
await Promise.all([
  copyFile("./src/client/index.html", "./public/index.html"),
  copyFile("./src/client/styles.css", "./public/styles.css"),
]);
