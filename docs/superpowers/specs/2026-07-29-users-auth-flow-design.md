# Flow: Users & Auth — Desain

- **Tanggal:** 2026-07-29
- **Status:** Draft (menunggu review)
- **Cakupan dok ini:** Identitas self-contained — model User, **register/login/me**, **direktori user** (picker), self-service profil/password, dan **admin user management**. Ini mengisi bagian "auth/login" yang di [fondasi](./2026-07-29-platform-foundation-design.md) ditandai out-of-scope, dan **memblokir** semua picker owner/assignee/member.
- **Terkait:** [Fondasi](./2026-07-29-platform-foundation-design.md) · [Members](./2026-07-29-project-members-tab-flow-design.md) · [Create Projek](./2026-07-29-create-project-flow-design.md)

---

## 1. Ringkasan & Prinsip

Identitas **lokal & self-contained** (tanpa OIDC): **phone + password**. Alur: **self-register → `pending` → approval admin → `active`**. Login menerbitkan **JWT HS256** yang diverifikasi interceptor Connect (fondasi §8) — dok ini adalah sisi **penerbit** JWT + model user.

Keputusan yang membentuk desain:

- **Auth:** phone + password. Password di-hash **Argon2id**.
- **Registrasi:** self-register, butuh **approval admin** sebelum bisa login.
- **Permission ringkas:** user aktif membawa **base-role**; **admin** membawa `["*"]`. Akses per-projek dicek via **membership/ownership by `user.id`** (bukan permission granular).

## 2. Model Data — ECS Arke

| Komponen | Field | Semantik |
|---|---|---|
| `UserTag` | — | Penanda entity user. |
| `AdminTag` | — | Menandai user sebagai admin (→ permission `["*"]`). |
| `UserPhone` | `value: String` `#[pg(index, unique)]`, `verified: bool` | Nomor telepon = identitas login. **Unik.** |
| `UserPassword` | `hash: String`, `changed_at: String` | Hash **Argon2id** (PHC string). Tak pernah diekspos. |
| `UserProfile` | `display_name: String` `#[pg(index)]`, `avatar_url: String`, `email: String` | Profil tampil. |
| `UserStatus` | `value: UserStatusEnum` `#[pg(index)]`, `created_at: String`, `last_login_at: Option<String>` | `Pending / Active / Suspended`. |

```rust
#[derive(Component)] struct UserTag;
#[derive(Component)] struct AdminTag;

#[derive(Component)]
struct UserPhone { #[pg(index, unique)] value: String, verified: bool }

#[derive(Component)]
struct UserPassword { hash: String, changed_at: String } // Argon2id PHC

#[derive(Component)]
struct UserProfile { #[pg(index)] display_name: String, avatar_url: String, email: String }

#[derive(Component)]
struct UserStatus {
    #[pg(index)] value: UserStatusEnum,
    created_at: String,
    last_login_at: Option<String>,
}
#[derive(Component)] enum UserStatusEnum { Pending, Active, Suspended }
```

## 3. AuthUser & Permission

**`AuthUser`** yang dihasilkan interceptor dari klaim JWT (minimal, tanpa profil):

```
AuthUser { id: String, permissions: Vec<String>, is_admin: bool }
// is_admin = permissions.contains("*")
```

- **Klaim JWT:** `{ sub = user.id, permissions, exp }` (HS256, `AUTH_JWT_SECRET`, `AUTH_JWT_EXPIRES_IN` default 7d).
- **Permission diterbitkan saat login:**
  - **Admin** (punya `AdminTag`) → `permissions = ["*"]`.
  - **User aktif biasa** → `permissions = BASE_PERMISSIONS` (mis. `["projects:create"]`) — cukup untuk aksi self-serve; sisanya (baca/ubah dalam projek) di-gate oleh **membership/ownership by `user.id`** di tiap flow.
- Profil (phone/displayName/…) **tidak** di JWT; di-load via `Me`/direktori saat perlu.

## 4. Kontrak Backend (domain + Connect)

```proto
package sedjiwa.tasks.auth.v1;

service AuthService {
  rpc Register(RegisterRequest) returns (User);      // publik → status Pending
  rpc Login(LoginRequest) returns (LoginResponse);    // publik
  rpc Me(MeRequest) returns (User);                   // terautentikasi
  rpc UpdateMyProfile(UpdateMyProfileRequest) returns (User);   // self
  rpc ChangeMyPassword(ChangeMyPasswordRequest) returns (ChangeMyPasswordResponse); // self
}

service UserDirectoryService {
  rpc SearchUsers(SearchUsersRequest) returns (ListUsersResponse); // user aktif → picker
  rpc GetUser(GetUserRequest) returns (User);

  // Admin
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc UpdateUser(UpdateUserRequest) returns (User);
  rpc ActivateUser(UserIdRequest) returns (User);
  rpc SuspendUser(UserIdRequest) returns (User);
  rpc SetAdmin(SetAdminRequest) returns (User);
  rpc ResetPassword(ResetPasswordRequest) returns (OkResponse);
  rpc DeleteUser(UserIdRequest) returns (OkResponse);
}

message User {
  string id = 1; string phone = 2; string display_name = 3;
  string email = 4; string avatar_url = 5;
  UserStatus status = 6; bool is_admin = 7;
  string created_at = 8; optional string last_login_at = 9;
}
enum UserStatus { USER_STATUS_UNSPECIFIED = 0; PENDING = 1; ACTIVE = 2; SUSPENDED = 3; }

message RegisterRequest { string phone = 1; string password = 2; string display_name = 3; }
message LoginRequest { string phone = 1; string password = 2; }
message LoginResponse { string token = 1; User user = 2; }
message MeRequest {}
message UpdateMyProfileRequest { optional string display_name = 1; optional string avatar_url = 2; optional string email = 3; }
message ChangeMyPasswordRequest { string current_password = 1; string new_password = 2; }
message ChangeMyPasswordResponse { bool ok = 1; }

message SearchUsersRequest { optional string q = 1; } // cari displayName/phone
message GetUserRequest { string id = 1; }
message ListUsersRequest { optional UserStatus status = 1; }
message ListUsersResponse { repeated User users = 1; }
message CreateUserRequest { string phone = 1; string password = 2; string display_name = 3; bool is_admin = 4; }
message UpdateUserRequest { string id = 1; optional string display_name = 2; optional string email = 3; optional string avatar_url = 4; }
message UserIdRequest { string id = 1; }
message SetAdminRequest { string id = 1; bool is_admin = 2; }
message ResetPasswordRequest { string id = 1; string new_password = 2; }
message OkResponse { bool ok = 1; }
```

## 5. Aturan & Guard

| Operasi | Siapa | Aturan |
|---|---|---|
| `Register` | **publik** | Phone unik (bentrok → `ALREADY_EXISTS`). Password ≥ batas minimal. Status awal **`Pending`**. **Tidak** menerbitkan token. |
| `Login` | **publik** | Verifikasi Argon2. **Hanya `Active`** yang boleh login (`Pending`/`Suspended` → `FAILED_PRECONDITION` dengan pesan sesuai). Set `last_login_at`. Balikan `{token, user}`. |
| `Me` | terautentikasi | User dari `AuthUser.id`. |
| `UpdateMyProfile` | terautentikasi (self) | Ubah displayName/avatar/email sendiri. |
| `ChangeMyPassword` | terautentikasi (self) | Verifikasi `current_password`, set hash baru + `changed_at`. |
| `SearchUsers` / `GetUser` | user **aktif** | Untuk picker owner/assignee/member. Tak bocorkan hash. |
| `ListUsers` / `CreateUser` / `UpdateUser` / `ActivateUser` / `SuspendUser` / `SetAdmin` / `ResetPassword` / `DeleteUser` | **admin** | Manajemen user. `ActivateUser` = approval (`Pending`→`Active`). `SetAdmin` tambah/lepas `AdminTag`. |

- **Keamanan:** hash tak pernah keluar; presigned/error tak membocorkan keberadaan phone secara berlebihan (pesan login generik untuk kredensial salah).
- **Seed admin:** perlu jalur seeding admin pertama (mis. skrip seed idempoten) — analog `bun scripts/seed-users.ts`.

## 6. Frontend

- **Store:** `useAuthStore` (Zustand + persist) menyimpan `{ token, user, isAdmin }`; saat login/rehydrate → set token pada **transport Connect** (interceptor `Authorization: Bearer`). Menggantikan `setAuthToken` Apollo.
- **Halaman:** `login.tsx`, `register.tsx` (self-register → info "menunggu approval"), `admin-users.tsx` (list + activate/suspend/setAdmin/reset/delete), `settings.tsx` (UpdateMyProfile + ChangeMyPassword).
- **Guard rute:** unauth → `/login?redirect=…`; rute admin (`/admin/users`) gate pada `isAdmin`.
- **Hooks (Connect):** `useLogin`, `useRegister`, `useMe`, `useUpdateMyProfile`, `useChangeMyPassword`; `useSearchUsers`, `useUser`; admin: `useAdminUsers`, `useCreateUser`, `useUpdateUser`, `useActivateUser`, `useSuspendUser`, `useSetAdmin`, `useResetPassword`, `useDeleteUser`.
- **Picker:** `UserCombobox` memakai `SearchUsers` (dan di konteks projek, dibatasi ke member via daftar member).

## 7. Di Luar Cakupan

- **Verifikasi phone** (OTP/SMS) — `verified` ada di model tapi alur verifikasi ditunda.
- **Reset password self-service** (lupa password via OTP) — hanya admin `ResetPassword` untuk sekarang.
- **Refresh token / rotasi**, multi-device session management — token 7d sederhana dulu.
- **Migrasi user** & hash lama dari Bun (Argon2 vs hash lama) — dok migrasi tersendiri.
- **Role di luar admin/base** (mis. manager).

## 8. Keputusan Terbuka (usul)

1. **Isi `BASE_PERMISSIONS`.** — *Usul: minimal `["projects:create"]`; selebihnya via membership/ownership.*
2. **Batas panjang password & kebijakan.** — *Usul: min 8; kebijakan lanjutan YAGNI.*
3. **Kompat hash lama Bun.** — *Usul: tidak; user lama di-reset/re-hash saat migrasi (dok migrasi). Argon2 untuk semua yang baru.*
4. **Pemisahan service Auth vs UserDirectory** vs satu service. — *Usul: dua service seperti di atas (auth publik vs direktori/admin), boleh digabung saat implementasi bila lebih ringkas.*
5. **Pesan error login** generik vs spesifik status. — *Usul: generik untuk kredensial salah; spesifik hanya untuk `Pending`/`Suspended` (agar user tahu harus menunggu approval).*
