"use client";

import { CheckCheck } from "lucide-react";

import { NOTIFICATIONS_CHANGED_EVENT } from "@/components/notifications/unread-count";
import { ActionButton } from "@/components/shared/action-button";
import { markAllNotificationsRead } from "@/server/actions/notifications";

/** Marks every notification read, then refreshes the page and the unread badges. */
export function MarkAllReadButton() {
  return (
    <ActionButton
      action={async () => {
        const result = await markAllNotificationsRead();
        if (result?.ok) window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
        return result;
      }}
    >
      <CheckCheck aria-hidden />
      Mark all as read
    </ActionButton>
  );
}
