// apps/backend/src/archetypes/UserArcheType.ts
import {
  ArcheType,
  ArcheTypeField,
  BaseArcheType,
  type ArcheTypeOwnProperties,
} from "bunsane/core/ArcheType";
import {
  PhoneComponent,
  UserProfileComponent,
  UserStatusComponent,
} from "../components/UserComponents";
import { ArcheTypeNames } from "./ArcheTypeNames";

@ArcheType(ArcheTypeNames.User)
export class UserArcheTypeClass extends BaseArcheType {
  @ArcheTypeField(PhoneComponent)
  phone!: PhoneComponent;

  @ArcheTypeField(UserProfileComponent)
  profile!: UserProfileComponent;

  @ArcheTypeField(UserStatusComponent)
  status!: UserStatusComponent;
}

export type IUserArcheType = ArcheTypeOwnProperties<UserArcheTypeClass>;
