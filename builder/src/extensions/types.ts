import type { ComponentType } from 'react';

// A builder extension is the frontend counterpart to the backend's Extension
// concept (Prisma `Extension`, admin `/extensions`) — a self-contained,
// pluggable unit the core builder knows nothing about beyond this interface.
// Enablement is driven by a Foundation flag (Studio), not a separate toggle.
export interface BuilderExtension {
  id: string;
  // Foundation id (see /api/foundations) that gates this extension — its UI
  // only renders when that foundation is enabled.
  foundationId: string;
  label: string;
  // Contributes buttons/controls into the toolbar. Optional — an extension
  // with no UI contribution (e.g. a pure import/export codec) can omit this.
  ToolbarExtra?: ComponentType;
}
