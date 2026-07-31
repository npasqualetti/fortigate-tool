import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isProductionLike } from "@/lib/env";
import { signValue } from "@/lib/crypto";
import type { AppRole, SessionUser } from "@/lib/types";

const SESSION_COOKIE = "fortinet_rbac_session";
const MAX_AGE_SECONDS = 8 * 60 * 60;

type SessionPayload = SessionUser & {
  exp: number;
};

export async function createSession(user: SessionUser) {
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signValue(encoded);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, `${encoded}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProductionLike(),
    maxAge: MAX_AGE_SECONDS,
    path: "/"
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) {
    return null;
  }

  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature || signValue(encoded) !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      username: payload.username,
      displayName: payload.displayName,
      groups: payload.groups,
      roles: payload.roles,
      authProvider: payload.authProvider || "ad",
      mustChangePassword: Boolean(payload.mustChangePassword)
    };
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireRole(allowedRoles: AppRole[]) {
  const user = await requireUser();
  if (!user.roles.some((role) => allowedRoles.includes(role))) {
    redirect("/unauthorized");
  }
  return user;
}
