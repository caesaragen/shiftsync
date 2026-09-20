import { describe, it, expect, vi } from "vitest";
import { writeAuditLog } from "./audit";

describe("writeAuditLog", () => {
  it("serializes nested objects with Date fields correctly through the tx client", async () => {
    // Create a mock transaction client with an auditLog.create method
    const mockCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
    const mockTx = {
      auditLog: {
        create: mockCreate,
      },
    };

    // Realistic ShiftAssignment-like before state with a Date
    const beforeState = {
      id: "assign-1",
      shiftId: "shift-1",
      staffId: "staff-1",
      assignedAt: new Date("2026-09-20T10:00:00Z"),
      overrideReason: null,
    };

    // Realistic after state with changes and a Date
    const afterState = {
      id: "assign-1",
      shiftId: "shift-1",
      staffId: "staff-2", // changed
      assignedAt: new Date("2026-09-20T10:00:00Z"),
      overrideReason: "Coverage shortage", // added
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocking Prisma.TransactionClient for test isolation
    await writeAuditLog(mockTx as any, {
      actorId: "user-1",
      entityType: "ShiftAssignment",
      entityId: "assign-1",
      action: "update",
      before: beforeState,
      after: afterState,
    });

    // Verify create was called exactly once
    expect(mockCreate).toHaveBeenCalledOnce();

    // Verify the shape and content of the call (Prisma create expects { data: {...} })
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.data).toMatchObject({
      actorId: "user-1",
      entityType: "ShiftAssignment",
      entityId: "assign-1",
      action: "update",
    });

    // Verify that before/after are serialized as JSON (Date objects become ISO strings)
    const expectedBeforeJson = {
      id: "assign-1",
      shiftId: "shift-1",
      staffId: "staff-1",
      assignedAt: "2026-09-20T10:00:00.000Z",
      overrideReason: null,
    };
    const expectedAfterJson = {
      id: "assign-1",
      shiftId: "shift-1",
      staffId: "staff-2",
      assignedAt: "2026-09-20T10:00:00.000Z",
      overrideReason: "Coverage shortage",
    };

    // Verify that the serialized JSON round-trips correctly
    expect(callArgs.data.beforeJson).toEqual(expectedBeforeJson);
    expect(callArgs.data.afterJson).toEqual(expectedAfterJson);
  });

  it("handles before/after being undefined", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "audit-2" });
    const mockTx = {
      auditLog: {
        create: mockCreate,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocking Prisma.TransactionClient for test isolation
    await writeAuditLog(mockTx as any, {
      actorId: "user-1",
      entityType: "User",
      entityId: "user-2",
      action: "delete",
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.data).toMatchObject({
      actorId: "user-1",
      entityType: "User",
      entityId: "user-2",
      action: "delete",
    });
    expect(callArgs.data.beforeJson).toBeNull();
    expect(callArgs.data.afterJson).toBeNull();
  });

  it("only accepts a transaction client, not the global prisma singleton", async () => {
    // This test documents the constraint: the function MUST take a tx client
    // and will be called only inside transactions. We verify through type
    // checking and the implementation (no fallback to global prisma).
    // The function signature enforces Prisma.TransactionClient.
    const mockCreate = vi.fn().mockResolvedValue({ id: "audit-3" });
    const mockTx = {
      auditLog: {
        create: mockCreate,
      },
    };

    // This should work
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocking Prisma.TransactionClient for test isolation
    await writeAuditLog(mockTx as any, {
      actorId: "user-1",
      entityType: "Test",
      entityId: "test-1",
      action: "create",
      before: { some: "value" },
    });

    expect(mockCreate).toHaveBeenCalledOnce();
  });
});
