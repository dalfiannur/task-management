import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { TaskMediaLinkTag, TaskMediaLinkData } from "../components/TaskMediaLink";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.TaskMediaLink)
export class TaskMediaLinkArcheType extends BaseArcheType {
  @ArcheTypeField(TaskMediaLinkTag)
  tag!: TaskMediaLinkTag;

  @ArcheTypeField(TaskMediaLinkData)
  taskMediaLinkData!: TaskMediaLinkData;
}

export type ITaskMediaLinkArcheType = ArcheTypeOwnProperties<TaskMediaLinkArcheType>;
