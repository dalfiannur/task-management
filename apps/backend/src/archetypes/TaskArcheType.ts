import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { TaskInfo } from "../components/TaskInfo";
import { TaskAssignment } from "../components/TaskAssignment";
import { TaskLabels } from "../components/TaskLabels";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Task)
export class TaskArcheType extends BaseArcheType {
  @ArcheTypeField(TaskInfo)
  taskInfo!: TaskInfo;

  @ArcheTypeField(TaskAssignment)
  taskAssignment!: TaskAssignment;

  @ArcheTypeField(TaskLabels)
  taskLabels!: TaskLabels;
}

export type ITaskArcheType = ArcheTypeOwnProperties<TaskArcheType>;
