"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Fortinet RBAC Login</CardTitle>
        <CardDescription>
          Use Active Directory credentials, or local test accounts (admin, helpdesk, telecom, fuel) for development.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" autoComplete="username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {state?.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {state.error}
            </div>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
