import { handleApi as handleDatabaseApi } from "../src/server/api-handler.ts";
import { handleLocalDemoApi } from "../src/server/local-demo.ts";

export async function handleApi(request: Request): Promise<Response> {
  return process.env.SMARTROOM_LOCAL_DEMO === "true"
    ? handleLocalDemoApi(request)
    : handleDatabaseApi(request);
}
