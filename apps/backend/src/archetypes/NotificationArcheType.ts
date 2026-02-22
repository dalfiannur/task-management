import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
} from "bunsane/core/ArcheType";
import { NotificationInfo } from "../components/NotificationInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Notification)
export class NotificationArcheType extends BaseArcheType {
  @ArcheTypeField(NotificationInfo)
  notificationInfo!: NotificationInfo;
}
