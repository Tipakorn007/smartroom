import { handleApi } from "../src/server/api-handler";

export default {
  fetch(request: Request): Promise<Response> {
    return handleApi(request);
  },
};
