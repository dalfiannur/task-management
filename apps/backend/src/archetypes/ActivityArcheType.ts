import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
} from "bunsane/core/ArcheType";
import { ActivityInfo } from "../components/ActivityInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Activity)
export class ActivityArcheType extends BaseArcheType {
  @ArcheTypeField(ActivityInfo)
  activityInfo!: ActivityInfo;
}
