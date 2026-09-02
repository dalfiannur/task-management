// Flat FE type for the tokens domain, mapped from gen/tokens_pb.

/** PAT metadata as shown by the UI. The plaintext is never present here —
 *  it exists exactly once, in the CreateToken response, not in this type. */
export type AccessToken = {
  id: string;
  name: string;
  /** Last 4 characters — the only plaintext remnant still visible. */
  preview: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  expired: boolean;
};
