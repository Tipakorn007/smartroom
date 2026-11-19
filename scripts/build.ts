import { copyFile, mkdir } from "node:fs/promises";

const result = await Bun.build({
  entrypoints: ["./src/client/main.ts", "./src/client/admin.ts"],
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
  copyFile("./src/client/admin.html", "./public/admin.html"),
  copyFile("./src/client/styles.css", "./public/styles.css"),
  copyFile("./src/client/assets/smartroom-icon.png", "./public/smartroom-icon.png"),
  copyFile("./src/client/assets/smartroom-logo.png", "./public/smartroom-logo.png"),
]);

const apiResult = await Bun.build({
  entrypoints: ["./api/_handler.ts"],
  outdir: "./api",
  target: "node",
  minify: true,
});

if (!apiResult.success) {
  for (const log of apiResult.logs) console.error(log);
  throw new Error("สร้าง API bundle ไม่สำเร็จ");
}
