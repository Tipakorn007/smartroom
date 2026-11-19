import { handleApi } from "./_handler.js";

export function GET(request: Request): Promise<Response> {
  return handleApi(request);
}

export function POST(request: Request): Promise<Response> {
  return handleApi(request);
}
