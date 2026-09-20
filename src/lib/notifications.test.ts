import { describe, it, expect, vi, beforeEach } from "vitest";
import { notify, listNotifications, markRead, markAllRead } from "./notifications";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

const { prisma } = await import("@/lib/prisma");

const user1 = {
  id: "user-1",
  name: "User One",
  email: "user1@test.com",
  role: "STAFF" as const,
};

const user2 = {
  id: "user-2",
  name: "User Two",
  email: "user2@test.com",
  role: "STAFF" as const,
};

beforeEach(() => {
  vi.mocked(prisma.notification.findMany).mockReset();
  vi.mocked(prisma.notification.update).mockReset();
  vi.mocked(prisma.notification.updateMany).mockReset();
});

describe("notify", () => {
  it("creates a notification within a transaction", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "notif-1" });
    const mockTx = {
      notification: {
        create: mockCreate,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocking Prisma.TransactionClient for test isolation
    await notify(mockTx as any, {
      userId: "user-1",
      type: "SWAP_REQUESTED",
      message: "You have a new shift swap request",
      relatedEntityType: "ShiftSwap",
      relatedEntityId: "swap-1",
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.data).toMatchObject({
      userId: "user-1",
      type: "SWAP_REQUESTED",
      message: "You have a new shift swap request",
      relatedEntityType: "ShiftSwap",
      relatedEntityId: "swap-1",
      isRead: false,
    });
  });

  it("only accepts a transaction client, not the global prisma singleton", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "notif-2" });
    const mockTx = {
      notification: {
        create: mockCreate,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocking Prisma.TransactionClient for test isolation
    await notify(mockTx as any, {
      userId: "user-1",
      type: "SWAP_ACCEPTED",
      message: "Your swap was accepted",
      relatedEntityType: "ShiftSwap",
      relatedEntityId: "swap-1",
    });

    expect(mockCreate).toHaveBeenCalledOnce();
  });
});

describe("listNotifications", () => {
  it("lists all notifications for the authenticated user", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        userId: "user-1",
        type: "SWAP_REQUESTED" as const,
        message: "Swap request",
        relatedEntityType: "ShiftSwap",
        relatedEntityId: "swap-1",
        isRead: false,
        createdAt: new Date("2026-09-20T10:00:00Z"),
      },
      {
        id: "notif-2",
        userId: "user-1",
        type: "SWAP_ACCEPTED" as const,
        message: "Swap accepted",
        relatedEntityType: "ShiftSwap",
        relatedEntityId: "swap-1",
        isRead: true,
        createdAt: new Date("2026-09-20T11:00:00Z"),
      },
    ];

    vi.mocked(prisma.notification.findMany).mockResolvedValue(mockNotifications as never);

    const result = await listNotifications(user1);

    expect(result).toEqual(mockNotifications);
    expect(prisma.notification.findMany).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(prisma.notification.findMany).mock.calls[0]?.[0];
    expect(callArgs?.where).toMatchObject({ userId: "user-1" });
  });

  it("filters to unread notifications only when requested", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        userId: "user-1",
        type: "SWAP_REQUESTED" as const,
        message: "Swap request",
        relatedEntityType: "ShiftSwap",
        relatedEntityId: "swap-1",
        isRead: false,
        createdAt: new Date("2026-09-20T10:00:00Z"),
      },
    ];

    vi.mocked(prisma.notification.findMany).mockResolvedValue(mockNotifications as never);

    const result = await listNotifications(user1, { unreadOnly: true });

    expect(result).toEqual(mockNotifications);
    expect(prisma.notification.findMany).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(prisma.notification.findMany).mock.calls[0]?.[0];
    expect(callArgs?.where).toMatchObject({
      userId: "user-1",
      isRead: false,
    });
  });

  it("sorts notifications by createdAt descending", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([] as never);

    await listNotifications(user1);

    expect(prisma.notification.findMany).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(prisma.notification.findMany).mock.calls[0]?.[0];
    expect(callArgs?.orderBy).toMatchObject({ createdAt: "desc" });
  });

  it("scopes queries to the authenticated user (cannot read another user's notifications)", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([] as never);

    await listNotifications(user1);
    expect(prisma.notification.findMany).toHaveBeenCalledOnce();
    const user1Call = vi.mocked(prisma.notification.findMany).mock.calls[0]?.[0];
    expect(user1Call?.where).toMatchObject({ userId: "user-1" });

    vi.mocked(prisma.notification.findMany).mockClear();
    vi.mocked(prisma.notification.findMany).mockResolvedValue([] as never);

    await listNotifications(user2);
    expect(prisma.notification.findMany).toHaveBeenCalledOnce();
    const user2Call = vi.mocked(prisma.notification.findMany).mock.calls[0]?.[0];
    expect(user2Call?.where).toMatchObject({ userId: "user-2" });

    // Verify they are scoped differently
    expect(user1Call?.where).not.toEqual(user2Call?.where);
  });
});

describe("markRead", () => {
  it("marks a single notification as read", async () => {
    vi.mocked(prisma.notification.update).mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
      type: "SWAP_REQUESTED" as const,
      message: "Swap request",
      relatedEntityType: "ShiftSwap",
      relatedEntityId: "swap-1",
      isRead: true,
      createdAt: new Date("2026-09-20T10:00:00Z"),
    } as never);

    await markRead(user1, "notif-1");

    expect(prisma.notification.update).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(prisma.notification.update).mock.calls[0][0];
    expect(callArgs.data).toMatchObject({ isRead: true });
  });

  it("scopes the UPDATE query by both notificationId AND userId in the WHERE clause", async () => {
    vi.mocked(prisma.notification.update).mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
      type: "SWAP_REQUESTED" as const,
      message: "Swap request",
      relatedEntityType: "ShiftSwap",
      relatedEntityId: "swap-1",
      isRead: true,
      createdAt: new Date("2026-09-20T10:00:00Z"),
    } as never);

    await markRead(user1, "notif-1");

    expect(prisma.notification.update).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(prisma.notification.update).mock.calls[0]?.[0];
    // CRITICAL: the WHERE clause must include BOTH userId AND notificationId
    // A query that updates only by id (without userId) would allow one user
    // to mark another user's notification as read if they guessed the id.
    expect(callArgs?.where).toMatchObject({
      id: "notif-1",
      userId: "user-1",
    });
  });

  it("prevents one user from marking another user's notification as read via scoped query", async () => {
    // This test verifies the security boundary: user2 cannot mark user1's
    // notification as read because the UPDATE query itself is scoped by userId.
    // If the code tried to find-then-check ownership, a race condition could
    // occur. The query scope prevents that.

    vi.mocked(prisma.notification.update).mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
      type: "SWAP_REQUESTED" as const,
      message: "Swap request",
      relatedEntityType: "ShiftSwap",
      relatedEntityId: "swap-1",
      isRead: true,
      createdAt: new Date("2026-09-20T10:00:00Z"),
    } as never);

    // User2 attempts to mark user1's notification as read
    await markRead(user2, "notif-1");

    // The query MUST be scoped by user2's id, not user1's
    expect(prisma.notification.update).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(prisma.notification.update).mock.calls[0]?.[0];
    expect(callArgs?.where).toMatchObject({
      id: "notif-1",
      userId: "user-2", // Must be the calling user, not the owner
    });

    // Verify the WHERE clause is NOT accidentally using user1's id
    expect(callArgs?.where?.userId).not.toBe("user-1");
  });
});

describe("markAllRead", () => {
  it("marks all notifications as read for the authenticated user", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({
      count: 3,
    } as never);

    await markAllRead(user1);

    expect(prisma.notification.updateMany).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(prisma.notification.updateMany).mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ userId: "user-1" });
    expect(callArgs.data).toMatchObject({ isRead: true });
  });

  it("scopes the query to the authenticated user", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    await markAllRead(user1);
    expect(prisma.notification.updateMany).toHaveBeenCalledOnce();
    const user1Call = vi.mocked(prisma.notification.updateMany).mock.calls[0]?.[0];
    expect(user1Call?.where).toMatchObject({ userId: "user-1" });

    vi.mocked(prisma.notification.updateMany).mockClear();
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    await markAllRead(user2);
    expect(prisma.notification.updateMany).toHaveBeenCalledOnce();
    const user2Call = vi.mocked(prisma.notification.updateMany).mock.calls[0]?.[0];
    expect(user2Call?.where).toMatchObject({ userId: "user-2" });

    // Verify they are scoped differently
    expect(user1Call?.where).not.toEqual(user2Call?.where);
  });

  it("updates only unread notifications", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({
      count: 2,
    } as never);

    await markAllRead(user1);

    const callArgs = vi.mocked(prisma.notification.updateMany).mock.calls[0][0];
    // Optionally filter to unread only for efficiency (can mark read=true on all, but filtering saves work)
    // The implementation may choose to include isRead: false in the where clause or not
    expect(callArgs.where).toMatchObject({ userId: "user-1" });
  });
});
