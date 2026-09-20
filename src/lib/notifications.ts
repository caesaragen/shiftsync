import { Prisma, type Notification, type NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";

/**
 * Write a notification within a transaction.
 *
 * This function MUST be called only from inside the same transaction as the
 * event it announces. This ensures atomicity: the notification and the change
 * it records can never fall out of sync under a race or a partial failure.
 *
 * It does not accept the global prisma singleton; it takes a transaction client
 * explicitly to enforce this constraint.
 *
 * @param tx - Prisma transaction client (not the global singleton)
 * @param input - Notification data: userId, type, message, relatedEntity info
 */
export async function notify(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    type: NotificationType;
    message: string;
    relatedEntityType: string;
    relatedEntityId: string;
  },
): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      message: input.message,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      isRead: false,
    },
  });
}

/**
 * List notifications for the authenticated user.
 *
 * @param user - SessionUser with id, name, email, role
 * @param opts - Optional filters: unreadOnly to list only unread notifications
 * @returns Array of notifications sorted by createdAt descending
 */
export async function listNotifications(
  user: SessionUser,
  opts?: { unreadOnly?: boolean },
): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: {
      userId: user.id,
      ...(opts?.unreadOnly && { isRead: false }),
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Mark a single notification as read.
 *
 * The UPDATE query is scoped by BOTH notificationId AND userId to ensure
 * one user cannot mark another user's notification as read (prevents a race
 * condition where ownership is checked after the fact).
 *
 * @param user - SessionUser with id, name, email, role
 * @param notificationId - ID of the notification to mark as read
 */
export async function markRead(user: SessionUser, notificationId: string): Promise<void> {
  await prisma.notification.update({
    where: {
      id: notificationId,
      userId: user.id,
    },
    data: {
      isRead: true,
    },
  });
}

/**
 * Mark all notifications as read for the authenticated user.
 *
 * @param user - SessionUser with id, name, email, role
 */
export async function markAllRead(user: SessionUser): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      userId: user.id,
    },
    data: {
      isRead: true,
    },
  });
}
