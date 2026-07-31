"use server";

import { redirect } from "next/navigation";
import { authenticateLdapUser } from "@/lib/auth/ldap";
import { createSession, destroySession, requireUser } from "@/lib/auth/session";
import { getLocalUserByUsername, rolesForGroups, updateLocalUserPassword, writeAudit } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";

export async function loginAction(_: { error?: string } | undefined, formData: FormData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  let redirectTo = "/";

  try {
    const localUser = getLocalUserByUsername(username);
    if (localUser) {
      if (localUser.disabled || !verifyPassword(password, localUser.passwordHash)) {
        writeAudit({
          username,
          action: "login",
          targetType: "auth",
          targetId: null,
          status: "denied",
          details: "Local bootstrap admin login failed."
        });
        return { error: "Login failed. Check your username and password." };
      }

      await createSession({
        username: localUser.username,
        displayName: localUser.displayName,
        groups: ["local-admin"],
        roles: ["network_admin"],
        authProvider: "local",
        mustChangePassword: localUser.mustChangePassword
      });
      writeAudit({
        username,
        action: "login",
        targetType: "auth",
        targetId: null,
        status: "success",
        details: localUser.mustChangePassword
          ? "Bootstrap admin logged in and must change password."
          : "Local admin logged in."
      });
      redirectTo = localUser.mustChangePassword ? "/change-password" : "/";
    } else {
      const ldapUser = await authenticateLdapUser(username, password);
      const roles = rolesForGroups(ldapUser.groups);

      if (roles.length === 0) {
        writeAudit({
          username,
          action: "login",
          targetType: "auth",
          targetId: null,
          status: "denied",
          details: "Authenticated user is not a member of any configured access group."
        });
        return { error: "You are not in an Active Directory group approved for this platform." };
      }

      await createSession({ ...ldapUser, roles, authProvider: "ad", mustChangePassword: false });
      writeAudit({
        username,
        action: "login",
        targetType: "auth",
        targetId: null,
        status: "success",
        details: `Roles: ${roles.join(", ")}`
      });
    }
  } catch (error) {
    writeAudit({
      username: username || "unknown",
      action: "login",
      targetType: "auth",
      targetId: null,
      status: "error",
      details: error instanceof Error ? error.message : "Unknown login failure."
    });
    return { error: "Login failed. Check your username, password, and AD connectivity." };
  }

  redirect(redirectTo);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(_: { error?: string } | undefined, formData: FormData) {
  const user = await requireUser();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (user.authProvider !== "local") {
    return { error: "Password changes here are only for the local bootstrap admin account." };
  }

  if (password.length < 12) {
    return { error: "Password must be at least 12 characters long." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  updateLocalUserPassword(user.username, password);
  await createSession({ ...user, mustChangePassword: false });
  writeAudit({
    username: user.username,
    action: "local_admin.password_change",
    targetType: "auth",
    targetId: user.username,
    status: "success",
    details: "Local bootstrap admin changed the initial password."
  });
  redirect("/");
}
