import type { AccessToken as AccessTokenProto } from "@/lib/gen/tokens_pb";
import type { AccessToken } from "../types";

export function mapToken(t: AccessTokenProto): AccessToken {
  return {
    id: t.id,
    name: t.name,
    preview: t.preview,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt ?? null,
    lastUsedAt: t.lastUsedAt ?? null,
    expired: t.expired,
  };
}
