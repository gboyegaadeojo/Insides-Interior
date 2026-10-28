import { monotonicFactory } from "ulid";

// SPEC 8.1: text ids generated server-side as prefixed ULIDs.
const ulid = monotonicFactory();

export type IdPrefix =
  | "biz"
  | "usr"
  | "tax"
  | "seq"
  | "cli"
  | "con"
  | "sit"
  | "itm"
  | "rtp"
  | "rtl"
  | "prj"
  | "qte"
  | "qrv"
  | "qac"
  | "inv"
  | "irv"
  | "iln"
  | "ilt"
  | "pay"
  | "crd"
  | "exp"
  | "cnv"
  | "msg"
  | "chg"
  | "eml"
  | "pev"
  | "ntf"
  | "act"
  | "job";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
