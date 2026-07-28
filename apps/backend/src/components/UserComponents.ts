// apps/backend/src/components/UserComponents.ts
import { BaseComponent, CompData, Component } from "bunsane/core/components";

@Component
export class UserTag extends BaseComponent {}

@Component
export class AdminTag extends BaseComponent {}

@Component
export class PhoneComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "";

  @CompData()
  verified: boolean = false;
}

@Component
export class PasswordComponent extends BaseComponent {
  @CompData()
  hash: string = "";

  @CompData()
  changedAt: Date = new Date();
}

@Component
export class UserProfileComponent extends BaseComponent {
  @CompData({ indexed: true })
  displayName: string = "";

  @CompData()
  avatarUrl: string = "";

  @CompData()
  email: string = "";
}

@Component
export class UserStatusComponent extends BaseComponent {
  @CompData({ indexed: true })
  value: string = "pending"; // pending | active | suspended

  @CompData()
  createdAt: Date = new Date();

  @CompData()
  lastLoginAt: Date | null = null;
}
