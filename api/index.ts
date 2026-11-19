import { handleApi } from "../src/server/api-handler.ts";

export function GET(request: Request): Promise<Response> {
  return handleApi(request);
}

export function POST(request: Request): Promise<Response> {
  return handleApi(request);
}
