import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { NotificationInfo } from "../components/NotificationInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Notification)
export class NotificationArcheType extends BaseArcheType {
  @ArcheTypeField(NotificationInfo)
  notificationInfo!: NotificationInfo;
}

export type INotificationArcheType = ArcheTypeOwnProperties<NotificationArcheType>;
