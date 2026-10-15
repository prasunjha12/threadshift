import { replaceTextAtomically } from "../core/files.js";
import type { ConversionReport, Warning } from "../core/types.js";

export interface DeliveryResult {
  status: "launched" | "failed";
  sessionId?: string;
  exitCode: number | null;
  warnings: Warning[];
  error?: string;
}

export async function updateReport(path: string, report: ConversionReport): Promise<void> {
  await replaceTextAtomically(path, `${JSON.stringify(report, null, 2)}\n`);
}
