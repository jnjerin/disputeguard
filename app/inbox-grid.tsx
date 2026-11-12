"use client";
/**
 * PURPOSE
 * The disputes inbox, built on AG Grid Community.
 * Columns use custom React cell renderers:
 * - Deadline: live countdown coloured by urgency (sorted most urgent first by default)
 * - AI verdict: FIGHT/SETTLE badge with a confidence bar
 * - Flags: a shield warning when buyer text tried to manipulate the AI
 * Clicking a row opens the dispute's case file. Filtering and sorting are AG Grid built-ins.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { ShieldAlert } from "lucide-react";
import { Countdown, VerdictBadge } from "@/components/ui";
import { money, reasonLabel, statusLabel } from "@/lib/format";

ModuleRegistry.registerModules([AllCommunityModule]);

export type InboxRow = {
  id: string;
  buyer: string | null;
  reason: string;
  status: string;
  stage: string | null;
  amountValue: string | null;
  amountCurrency: string | null;
  due: string | null;
  decision: string | null;
  confidence: number | null;
  injection: boolean;
  evidenceCount: number;
  createdAt: string | null;
};

// App-matched AG Grid theme (Theming API): indigo accent, soft borders, roomy rows.
const theme = themeQuartz.withParams({
  accentColor: "#4f46e5",
  borderColor: "#e2e8f0",
  headerBackgroundColor: "#f8fafc",
  headerTextColor: "#475569",
  fontFamily: "inherit",
  fontSize: 13,
  rowHeight: 52,
  headerHeight: 40,
  wrapperBorderRadius: 12,
  rowHoverColor: "#eef2ff",
});

export function InboxGrid({ rows }: { rows: InboxRow[] }) {
  const router = useRouter();

  const columns = useMemo<ColDef<InboxRow>[]>(
    () => [
      {
        headerName: "Deadline",
        field: "due",
        sort: "asc",
        width: 150,
        comparator: (a, b) => (a ? new Date(a).getTime() : Infinity) - (b ? new Date(b).getTime() : Infinity),
        cellRenderer: (p: ICellRendererParams<InboxRow>) => <Countdown due={p.value ?? null} />,
      },
      {
        headerName: "Dispute",
        field: "id",
        flex: 1.3,
        minWidth: 190,
        filter: true,
        cellRenderer: (p: ICellRendererParams<InboxRow>) => (
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-xs text-slate-900">{p.value}</span>
            <span className="text-xs text-slate-500">{p.data?.buyer ?? "Buyer"}</span>
          </div>
        ),
      },
      { headerName: "Reason", field: "reason", flex: 1, minWidth: 150, filter: true, valueFormatter: (p) => reasonLabel(p.value) },
      {
        headerName: "Amount",
        field: "amountValue",
        width: 110,
        type: "rightAligned",
        comparator: (a, b) => Number(a ?? 0) - Number(b ?? 0),
        valueFormatter: (p) => money(p.value, p.data?.amountCurrency),
      },
      {
        headerName: "Status",
        field: "status",
        flex: 1,
        minWidth: 170,
        filter: true,
        cellRenderer: (p: ICellRendererParams<InboxRow>) => (
          <span className="inline-flex flex-col leading-tight">
            <span className="text-slate-800">{statusLabel(p.value)}</span>
            {p.data?.stage && <span className="text-[11px] uppercase tracking-wide text-slate-400">{p.data.stage}</span>}
          </span>
        ),
      },
      {
        headerName: "AI verdict",
        field: "decision",
        width: 190,
        filter: true,
        cellRenderer: (p: ICellRendererParams<InboxRow>) => <VerdictBadge decision={p.value ?? null} confidence={p.data?.confidence ?? null} />,
      },
      {
        headerName: "Flags",
        field: "injection",
        width: 110,
        cellRenderer: (p: ICellRendererParams<InboxRow>) =>
          p.value ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700" title="Buyer text tried to manipulate the AI">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Injection
            </span>
          ) : null,
      },
      { headerName: "Evidence", field: "evidenceCount", width: 100, type: "rightAligned" },
    ],
    [],
  );

  return (
    <AgGridReact<InboxRow>
      theme={theme}
      rowData={rows}
      columnDefs={columns}
      defaultColDef={{ sortable: true, resizable: true }}
      domLayout="autoHeight"
      rowClass="cursor-pointer"
      onRowClicked={(e) => e.data && router.push(`/disputes/${encodeURIComponent(e.data.id)}`)}
      overlayNoRowsTemplate="No disputes yet. File one as the sandbox buyer, or click Sync from PayPal."
    />
  );
}
