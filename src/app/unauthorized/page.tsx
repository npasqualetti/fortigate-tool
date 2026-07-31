import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            Your account is signed in, but your assigned role does not allow access to this area.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/">Return to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
