import { request } from "./request.js";

export function listMerchants() {
  return request("/merchants");
}
