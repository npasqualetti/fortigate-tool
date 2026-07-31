"use client";

import { useEffect, useState, useActionState } from "react";
import { saveSiteAction } from "@/lib/admin/actions";
import { useActionStateToast } from "@/hooks/use-action-state-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function SiteDialog() {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(saveSiteAction, undefined);

  useActionStateToast(state, pending);

  useEffect(() => {
    if (state?.message && !pending) {
      setOpen(false);
      setFormKey((current) => current + 1);
    }
  }, [state?.message, pending]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add site</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add or update site</DialogTitle>
          <DialogDescription>Site numbers are unique; saving an existing number updates it.</DialogDescription>
        </DialogHeader>
        <form key={formKey} action={action} className="grid gap-4 md:grid-cols-2">
          <Field name="siteNumber" label="Site number" />
          <Field name="name" label="Site name" />
          <Field name="address1" label="Address 1" />
          <Field name="address2" label="Address 2" required={false} />
          <Field name="city" label="City" />
          <Field name="state" label="State" />
          <Field name="postalCode" label="Postal code" />
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <Button type="submit" className="md:col-span-2" disabled={pending}>
            {pending ? "Saving..." : "Save site"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ name, label, required = true }: { name: string; label: string; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required={required} />
    </div>
  );
}
