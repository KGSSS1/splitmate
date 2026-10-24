"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import { isTheme } from "@/lib/theme";
import { signOut } from "@/server/actions/auth";

import { SECONDARY_NAV } from "./nav-config";

/** Phone menu for secondary pages, theme and logging out (SPEC §9). */
export function MobileMenu() {
  const [theme, setTheme] = useTheme();
  const [signingOut, startSignOut] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" className="size-11" aria-label="Open menu" />}>
        <Menu aria-hidden className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {SECONDARY_NAV.filter((item) => item.available).map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} render={<Link href={href} />} className="min-h-11">
            <Icon aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => isTheme(value) && setTheme(value)}>
            <DropdownMenuRadioItem value="light" className="min-h-11">
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className="min-h-11">
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" className="min-h-11">
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11"
          disabled={signingOut}
          onClick={() =>
            startSignOut(async () => {
              await signOut();
            })
          }
        >
          <LogOut aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
