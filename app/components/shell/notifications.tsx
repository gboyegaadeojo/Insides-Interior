import * as Popover from "@radix-ui/react-popover";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Eye,
  FileCheck2,
  type LucideIcon,
  MailWarning,
  MessageSquareText,
  Receipt,
} from "lucide-react";
import * as React from "react";
import { Link, useFetcher } from "react-router";
import { relativeTime } from "~/lib/activity-label";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Loading, Skeleton } from "../ui/states";

// The bell in the top bar (SPEC 5.12 FR-SYS-02): the unread count from the app
// layout, and the latest notifications loaded when it opens. Choosing one
// marks it read and opens what it's about.

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  href: string;
  createdAt: string;
  read: boolean;
}

interface NotificationData {
  items: NotificationItem[];
  unread: number;
}

const ICON: [RegExp, LucideIcon, string][] = [
  [/approved/, FileCheck2, "bg-sage-tint text-sage-ink"],
  [/drafted/, Receipt, "bg-indigo-tint text-indigo-ink"],
  [/changes_requested|message/, MessageSquareText, "bg-saffron-tint text-saffron-ink"],
  [/viewed/, Eye, "bg-ocean-tint text-ocean-ink"],
  [/bounced|complained/, MailWarning, "bg-danger-tint text-danger-ink"],
];

function iconFor(type: string) {
  return ICON.find(([pattern]) => pattern.test(type)) ?? [/./, AlertTriangle, "bg-surface-2 text-secondary"];
}

export function NotificationsBell({ unread }: { unread: number }) {
  const [open, setOpen] = React.useState(false);
  const list = useFetcher<NotificationData>();
  const mark = useFetcher();
  // Optimistic: marking all read clears the badge at once.
  const shown = mark.formData?.get("all") ? 0 : unread;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) list.load("/api/notifications");
  }

  const items = list.data?.items;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        className="relative inline-flex size-11 items-center justify-center rounded-control text-secondary hover:bg-surface-2 hover:text-primary"
        aria-label={shown > 0 ? `Notifications, ${shown} unread` : "Notifications"}
      >
        <Bell className="size-5" aria-hidden />
        {shown > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger-base px-1 text-micro font-bold text-danger-on tabular"
          >
            {shown > 99 ? "99+" : shown}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex max-h-[min(32rem,75dvh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-card border border-border bg-surface text-primary shadow-sheet"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <h2 className="flex-1 font-display text-section">Notifications</h2>
            {shown > 0 && (
              <mark.Form method="post" action="/api/notifications">
                <input type="hidden" name="all" value="1" />
                <Button type="submit" variant="ghost" className="text-label" loading={mark.state !== "idle"}>
                  <CheckCheck aria-hidden />
                  Mark all read
                </Button>
              </mark.Form>
            )}
          </div>
          <div className="overflow-y-auto">
            {!items ? (
              <Loading label="Loading notifications">
                <div className="flex flex-col gap-3 p-4">
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-control" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              </Loading>
            ) : items.length === 0 ? (
              <div className="p-5">
                <p className="font-semibold">You're all caught up</p>
                <p className="mt-1 text-secondary">
                  Approvals, views, messages and bounced emails appear here.
                </p>
              </div>
            ) : (
              <ul aria-label="Notifications" className="divide-y divide-border">
                {items.map((item) => {
                  const [, Icon, tone] = iconFor(item.type);
                  return (
                    <li key={item.id}>
                      <Link
                        to={item.href}
                        onClick={() => {
                          setOpen(false);
                          if (!item.read)
                            mark.submit({ id: item.id }, { method: "post", action: "/api/notifications" });
                        }}
                        className="flex min-h-14 items-start gap-3 px-4 py-3 hover:bg-surface-2"
                      >
                        <span
                          className={cn(
                            "inline-flex size-9 shrink-0 items-center justify-center rounded-control",
                            tone,
                          )}
                          aria-hidden
                        >
                          <Icon className="size-4.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block", item.read ? "text-secondary" : "font-semibold")}>
                            {item.title}
                          </span>
                          <time dateTime={item.createdAt} className="text-micro text-secondary">
                            {relativeTime(item.createdAt)}
                          </time>
                        </span>
                        {!item.read && (
                          <span
                            className="mt-2 size-2.5 shrink-0 rounded-full bg-ocean-base"
                            aria-label="Unread"
                            role="img"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
