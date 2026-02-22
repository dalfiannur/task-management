import { Component, CompData, BaseComponent } from "bunsane/core/components";

@Component
export class UserProfile extends BaseComponent {
  @CompData({ indexed: true })
  externalId: string = "";

  @CompData({ indexed: true })
  email: string = "";

  @CompData()
  name: string = "";

  @CompData()
  avatarUrl: string = "";

  @CompData()
  role: string = "member";
}
