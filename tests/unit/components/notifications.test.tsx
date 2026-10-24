import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationList } from "@/components/notifications/notification-list";
import { NotificationPreferencesForm } from "@/components/notifications/preferences-form";
import {
  NOTIFICATIONS_CHANGED_EVENT,
  NotificationsBellLink,
  UnreadBadge,
} from "@/components/notifications/unread-count";
import type { NotificationItem } from "@/lib/notifications/describe";
import { preferenceMap } from "@/lib/notifications/types";

const actions = vi.hoisted(() => ({
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("@/server/actions/notifications", () => actions);
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();

beforeEach(() => {
  navigation.pathname = "/dashboard";
  fetchMock.mockReset().mockImplementation(() => respond({ unread: 3 }));
  vi.stubGlobal("fetch", fetchMock);
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unread count", () => {
  it("shows the count with words for screen readers, and nothing at zero", async () => {
    const { rerender } = render(<UnreadBadge />);
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("unread")).toHaveClass("sr-only");
    expect(fetchMock).toHaveBeenCalledWith("/notifications/unread-count", { cache: "no-store", redirect: "manual" });

    fetchMock.mockImplementation(() => respond({ unread: 0 }));
    navigation.pathname = "/groups";
    rerender(<UnreadBadge key="next" />);
    await waitFor(() => expect(document.querySelector("[data-unread-badge]")).toBeNull());
  });

  it("refetches on navigation and when notifications are marked read", async () => {
    const { rerender } = render(<NotificationsBellLink />);
    expect(await screen.findByRole("link", { name: "Notifications, 3 unread" })).toHaveAttribute("href", "/notifications");

    fetchMock.mockImplementation(() => respond({ unread: 120 }));
    navigation.pathname = "/friends";
    rerender(<NotificationsBellLink />);
    expect(await screen.findByRole("link", { name: "Notifications, 99+ unread" })).toBeInTheDocument();

    fetchMock.mockImplementation(() => respond({ unread: 0 }));
    act(() => {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    });
    expect(await screen.findByRole("link", { name: "Notifications" })).toBeInTheDocument();
  });

  it("keeps quiet when signed out or offline", async () => {
    fetchMock.mockImplementation(() => respond({ error: "Not signed in" }, 401));
    render(<NotificationsBellLink />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();

    fetchMock.mockImplementation(() => Promise.reject(new TypeError("offline")));
    act(() => {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
  });
});

const ITEMS: NotificationItem[] = [
  {
    id: "n1",
    type: "expense_added",
    title: "Asha added “Dinner” (₹900.00)",
    detail: null,
    href: "/expenses/e1",
    at: "2026-10-24T10:00:00Z",
    read: false,
  },
  {
    id: "n2",
    type: "friend_accepted",
    title: "Bina accepted your friend request",
    detail: null,
    href: "/friends/b1",
    at: "2026-10-23T10:00:00Z",
    read: true,
  },
];

describe("NotificationList", () => {
  it("marks unread rows in words, not only with a dot", () => {
    render(<NotificationList items={ITEMS} timeZone="Asia/Kolkata" />);
    const rows = within(screen.getByRole("list", { name: "Notifications" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Unread: Asha added");
    expect(rows[1]).not.toHaveTextContent("Unread");
    expect(screen.getAllByRole("button", { name: /^Mark read/ })).toHaveLength(1);
  });

  it("marks a notification read and tells the badges", async () => {
    const changed = vi.fn();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
    const user = userEvent.setup();
    render(<NotificationList items={ITEMS} timeZone="Asia/Kolkata" />);

    await user.click(screen.getByRole("button", { name: "Mark read: Asha added “Dinner” (₹900.00)" }));
    expect(actions.markNotificationsRead).toHaveBeenCalledWith({ ids: ["n1"] });
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^Mark read/ })).toBeNull();
    window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
  });

  it("puts the row back and explains when marking fails", async () => {
    actions.markNotificationsRead.mockResolvedValue({ ok: false, error: "Something went wrong." });
    const user = userEvent.setup();
    render(<NotificationList items={ITEMS} timeZone="Asia/Kolkata" />);
    await user.click(screen.getByRole("button", { name: /^Mark read/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.getByRole("button", { name: /^Mark read/ })).toBeInTheDocument();
  });
});

describe("NotificationPreferencesForm", () => {
  it("sends every type with its switch", async () => {
    const user = userEvent.setup();
    const defaults = preferenceMap([{ type: "member_left", in_app: false }]);
    render(<NotificationPreferencesForm defaultValues={defaults} />);

    expect(screen.getByRole("checkbox", { name: "Someone leaves one of your groups" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Someone adds an expense you're part of" }));
    await user.click(screen.getByRole("button", { name: "Save notification settings" }));

    await waitFor(() => expect(actions.saveNotificationPreferences).toHaveBeenCalled());
    expect(actions.saveNotificationPreferences.mock.calls[0]?.[0]).toEqual({
      ...defaults,
      expense_added: false,
    });
  });
});
