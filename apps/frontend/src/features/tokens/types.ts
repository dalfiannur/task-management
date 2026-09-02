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
  /** Computed by the server against the current time at the moment of the
   *  listing request — a snapshot, not a live value. A token can tip past
   *  `expiresAt` moments after the response is sent, and the UI will still
   *  show it as active until the next refetch. The table trusts this field
   *  as-is rather than re-deriving from `expiresAt`, matching what the
   *  server already decided; it is corrected on the next list refresh
   *  (e.g. after any mutation invalidates the query). */
  expired: boolean;
};

/** Flat shape of a just-created token: the plaintext (shown exactly once,
 *  never fetchable again) plus its metadata row. */
export type CreatedToken = {
  plaintext: string;
  token: AccessToken;
};
