"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { useTheme } from "@/hooks/use-theme";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Segmented light / dark / system control built on native radio inputs. */
export function ThemePicker({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  // Radios sharing a name are one group page-wide; the sidebar and settings each have a picker.
  const name = useId();

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center md:min-h-9 justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors",
              "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              theme === value && "bg-background text-foreground shadow-sm",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon aria-hidden className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
