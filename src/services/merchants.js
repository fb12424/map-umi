import { request } from "./request.js";

export function listMerchants() {
  return request("/merchants");
}

export function listPlacedMerchants() {
  return request("/merchants/placed");
}
