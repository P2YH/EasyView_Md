/**
 * Agent-mode tools for the currently opened Office file (Phase 1: .xlsx).
 *
 * The tools take no path argument: they are hard-bound to the file the user has
 * open, so the model cannot read or write any other workbook. Writes require an
 * explicit user decision through `confirmEdit`; a rejected or unanswered
 * proposal never touches disk.
 */

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  XLSX_DEFAULT_PREVIEW_ROWS,
  XLSX_MAX_OPS,
  XLSX_MAX_PREVIEW_ROWS,
  commitXlsxProposal,
  inspectXlsxFile,
  isXlsxPath,
  planXlsxEdit,
  xlsxSheetOpSchema,
  type XlsxCommitRecord,
  type XlsxDiff,
  type XlsxProposal,
} from './xlsx-edit';
import { tAi } from './ai.i18n';

export type OfficeDocumentKind = 'xlsx';

export interface OfficeEditDecision {
  accepted: boolean;
  reason?: string;
}

export interface ActiveOfficeDocument {
  kind: OfficeDocumentKind;
  /** Absolute path of the opened file. */
  filePath: string;
  /** Directory that receives `.easyview/ai-backups/`. */
  backupRoot: string;
  /** Shows the diff to the user and resolves once they press Apply or Reject. */
  confirmEdit: (proposal: { id: string; fileName: string; diff: XlsxDiff }) => Promise<OfficeEditDecision>;
  /** Called after a successful write so the host can refresh the preview and offer undo. */
  onCommitted?: (record: XlsxCommitRecord, proposal: XlsxProposal) => void | Promise<void>;
}

/** Maps a file path to the Office kind that Agent mode can edit, if any. */
export function officeDocumentKind(filePath: string): OfficeDocumentKind | null {
  return isXlsxPath(filePath) ? 'xlsx' : null;
}

export function createOfficeAgentTools(document: ActiveOfficeDocument): ToolSet {
  if (document.kind !== 'xlsx' || !isXlsxPath(document.filePath)) throw new Error(tAi('xlsx.notXlsx'));
  const fileName = document.filePath.split(/[\\/]/).pop() ?? document.filePath;
  return {
    inspect_workbook: tool({
      description: tAi('xlsx.inspect.description'),
      inputSchema: z.object({
        maxRows: z.number().int().min(0).max(XLSX_MAX_PREVIEW_ROWS).optional().describe(tAi('xlsx.inspect.maxRows')),
      }),
      execute: async ({ maxRows }) => inspectXlsxFile(document.filePath, maxRows ?? XLSX_DEFAULT_PREVIEW_ROWS),
    }),
    apply_sheet_ops: tool({
      description: tAi('xlsx.apply.description', { max: XLSX_MAX_OPS }),
      inputSchema: z.object({
        fingerprint: z.string().min(1).describe(tAi('xlsx.apply.fingerprint')),
        ops: z.array(xlsxSheetOpSchema).min(1).max(XLSX_MAX_OPS),
      }),
      execute: async ({ fingerprint, ops }) => {
        const proposal = await planXlsxEdit(document.filePath, fingerprint, ops);
        if (proposal.diff.changes.length === 0 && proposal.diff.structural.length === 0) {
          return { status: 'no-change' as const };
        }
        const decision = await document.confirmEdit({ id: proposal.id, fileName, diff: proposal.diff });
        if (!decision.accepted) {
          return { status: 'rejected' as const, reason: decision.reason ?? tAi('xlsx.rejected') };
        }
        const record = await commitXlsxProposal(proposal, document.backupRoot);
        await document.onCommitted?.(record, proposal);
        return {
          status: 'applied' as const,
          changedCells: proposal.diff.changes.length,
          newFingerprint: record.writtenFingerprint,
        };
      },
    }),
  };
}
