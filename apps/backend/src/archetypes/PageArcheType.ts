import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
} from "bunsane/core/ArcheType";
import { PageInfo } from "../components/PageInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Page)
export class PageArcheType extends BaseArcheType {
  @ArcheTypeField(PageInfo)
  pageInfo!: PageInfo;
}
