export {};

process.env.SMARTROOM_LOCAL_DEMO = "true";
await import("../src/server/index.ts");
