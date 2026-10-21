import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/** Card frame shared by the sign-up, login and password pages. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-semibold">{title}</h1>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? <CardFooter className="justify-center text-sm text-muted-foreground">{footer}</CardFooter> : null}
    </Card>
  );
}
