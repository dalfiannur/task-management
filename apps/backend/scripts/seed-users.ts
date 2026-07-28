// apps/backend/scripts/seed-users.ts
import "reflect-metadata";
import "~/components/UserComponents";
import { Entity } from "bunsane/core/Entity";
import { Query } from "bunsane/query";
import {
  PhoneComponent, PasswordComponent, UserProfileComponent, UserStatusComponent, UserTag, AdminTag,
} from "~/components/UserComponents";
import { hashPassword } from "~/lib/user-serializer";

const SEED = [
  { phone: "081200000001", password: "admin123", displayName: "Admin", isAdmin: true },
  { phone: "081200000002", password: "member123", displayName: "Budi Member", isAdmin: false },
  { phone: "081200000003", password: "member123", displayName: "Sari Member", isAdmin: false },
];

for (const u of SEED) {
  const existing = await new Query()
    .with(PhoneComponent, { filters: [Query.typedFilter(PhoneComponent, "value", "=", u.phone)] })
    .take(1)
    .exec();
  if (existing.length > 0) {
    console.log(`skip (exists): ${u.phone} ${u.displayName}`);
    continue;
  }
  const hash = await hashPassword(u.password);
  const entity = Entity.Create()
    .add(UserTag, {})
    .add(PhoneComponent, { value: u.phone, verified: true })
    .add(PasswordComponent, { hash, changedAt: new Date() })
    .add(UserProfileComponent, { displayName: u.displayName, avatarUrl: "", email: "" })
    .add(UserStatusComponent, { value: "active", createdAt: new Date(), lastLoginAt: null });
  if (u.isAdmin) entity.add(AdminTag, {});
  await entity.save();
  console.log(`created: ${u.phone} / ${u.password} — ${u.displayName}${u.isAdmin ? " (admin)" : ""}`);
}

console.log("Seed complete.");
process.exit(0);
