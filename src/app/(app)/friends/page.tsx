import { ChevronRight, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AddFriendForm } from "@/components/friends/add-friend-form";
import { ActionButton } from "@/components/shared/action-button";
import { BalanceText } from "@/components/shared/balance-text";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/lib/auth/routes";
import { acceptFriendRequest, deleteFriendRequest } from "@/server/actions/friends";
import { requireOnboardedProfile } from "@/server/auth";
import { type FriendRequest, getFriendsOverview } from "@/server/friends";

export const metadata: Metadata = { title: "Friends" };

export default async function FriendsPage() {
  await requireOnboardedProfile();
  const { friends, incoming, outgoing } = await getFriendsOverview();

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Friends</h1>
        <p className="text-muted-foreground">
          People you share expenses with. Joining a group makes you friends with its members.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Add a friend</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AddFriendForm />
        </CardContent>
      </Card>

      {incoming.length > 0 ? (
        <RequestList
          title="Friend requests"
          description="People who want to split expenses with you."
          requests={incoming}
          kind="incoming"
        />
      ) : null}

      <section aria-labelledby="friends-heading" className="grid gap-3">
        <h2 id="friends-heading" className="text-lg font-semibold">
          Your friends
        </h2>
        {friends.length === 0 ? (
          <EmptyState icon={UserRound} title="No friends yet">
            <p>Add a friend by email above, or create a group and invite people to it.</p>
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-xl border">
            {friends.map((friend) => (
              <li key={friend.id}>
                <Link
                  href={`${ROUTES.friends}/${friend.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{friend.displayName}</span>
                    <BalanceText balances={friend.balances} perspective="friend" />
                  </span>
                  <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {outgoing.length > 0 ? (
        <RequestList
          title="Sent requests"
          description="Waiting for them to accept."
          requests={outgoing}
          kind="outgoing"
        />
      ) : null}
    </div>
  );
}

function RequestList({
  title,
  description,
  requests,
  kind,
}: {
  title: string;
  description: string;
  requests: FriendRequest[];
  kind: "incoming" | "outgoing";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4">
          {requests.map((request) => (
            <li key={request.friendshipId} className="flex flex-wrap items-start justify-between gap-3">
              <span className="font-medium">{request.displayName}</span>
              <div className="flex flex-wrap gap-2">
                {kind === "incoming" ? (
                  <>
                    <ActionButton
                      variant="default"
                      action={acceptFriendRequest.bind(null, { friendshipId: request.friendshipId })}
                    >
                      Accept
                    </ActionButton>
                    <ActionButton action={deleteFriendRequest.bind(null, { friendshipId: request.friendshipId })}>
                      Decline
                    </ActionButton>
                  </>
                ) : (
                  <ActionButton action={deleteFriendRequest.bind(null, { friendshipId: request.friendshipId })}>
                    Withdraw
                  </ActionButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
