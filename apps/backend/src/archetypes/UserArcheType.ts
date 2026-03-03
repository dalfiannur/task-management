import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import { UserProfile } from "../components/UserProfile";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.User)
export class UserArcheType extends BaseArcheType {
  @ArcheTypeField(UserProfile)
  userProfile!: UserProfile;
}

export type IUserArcheType = ArcheTypeOwnProperties<UserArcheType>;
