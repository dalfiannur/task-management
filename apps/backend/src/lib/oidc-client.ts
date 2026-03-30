const OIDC_API_URL = process.env.OIDC_API_URL ?? "http://localhost:3100";

export async function fetchUserIdsByPermission(
  resource: string,
  action: string,
  authToken: string | null,
): Promise<string[]> {
  try {
    const params = new URLSearchParams({ resource, action });
    const res = await fetch(`${OIDC_API_URL}/api/v1/users/by-permission?${params}`, {
      method: "GET",
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });

    if (!res.ok) {
      console.error(`[oidc-client] fetchUserIdsByPermission failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const json = (await res.json()) as { userIds?: string[] };
    return json.userIds ?? [];
  } catch (err) {
    console.error(`[oidc-client] fetchUserIdsByPermission error:`, err);
    return [];
  }
}
