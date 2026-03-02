import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { PageInfo } from "../components/PageInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Page)
export class PageArcheType extends BaseArcheType {
  @ArcheTypeField(PageInfo)
  pageInfo!: PageInfo;
}

export type IPageArcheType = ArcheTypeOwnProperties<PageArcheType>;
