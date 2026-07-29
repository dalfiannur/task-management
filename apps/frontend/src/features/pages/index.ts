// Pages (wiki) feature barrel.

export type { Page } from "./types";
export { mapPage } from "./api/mappers";
export {
  usePages,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  useReorderPages,
} from "./api/hooks";
export { PagesTab } from "./components/pages-tab";
