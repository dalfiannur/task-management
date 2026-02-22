import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
} from "bunsane/core/ArcheType";
import { CommentInfo } from "../components/CommentInfo";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.Comment)
export class CommentArcheType extends BaseArcheType {
  @ArcheTypeField(CommentInfo)
  commentInfo!: CommentInfo;
}
