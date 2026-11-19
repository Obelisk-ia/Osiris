import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LinkButton({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof Link> & { variant?: "default" | "outline" | "secondary" }) {
  return (
    <Link
      className={cn(buttonVariants({ variant, size: "lg" }), "site-button", className)}
      {...props}
    />
  );
}
