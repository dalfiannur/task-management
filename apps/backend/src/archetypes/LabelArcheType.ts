import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { LabelInfo } from "../components/LabelInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Label)
export class LabelArcheType extends BaseArcheType {
  @ArcheTypeField(LabelInfo)
  labelInfo!: LabelInfo;
}

export type ILabelArcheType = ArcheTypeOwnProperties<LabelArcheType>;
