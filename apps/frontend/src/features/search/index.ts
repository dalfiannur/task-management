// Search feature barrel.

export type { SearchKind, SearchHit } from "./types";
export { useSearch, MIN_QUERY } from "./api/hooks";
export { searchOpenAtom, searchPersonAtom } from "./atoms/overlay";
export { SearchOverlay } from "./components/search-overlay";
