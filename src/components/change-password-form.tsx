"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Change initial admin password</CardTitle>
        <CardDescription>
          The local bootstrap admin must set a new password before accessing the platform.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" minLength={12} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" minLength={12} required />
          </div>
          {state?.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {state.error}
            </div>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Updating password..." : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
