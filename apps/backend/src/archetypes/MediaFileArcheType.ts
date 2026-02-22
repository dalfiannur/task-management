import {
  ArcheType,
  ArcheTypeField,
  BelongsTo,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { MediaFileInfo } from "../components/MediaFileInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.MediaFile)
export class MediaFileArcheType extends BaseArcheType {
  @ArcheTypeField(MediaFileInfo)
  mediaFileInfo!: MediaFileInfo;
}
