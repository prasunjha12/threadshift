import { resolve } from "node:path";
import { ThreadShiftError } from "../../core/errors.js";
import type { CaptureResult, RawRecord } from "../../core/types.js";
import { sanitizeCapture } from "../../core/privacy.js";
import { resolveHarness, runProcess } from "../../runtime/process.js";
import { requireCompatibleVersion } from "../../runtime/compatibility.js";
import { readPiSource } from "./read.js";
import { normalizePi, projectPiContext } from "./normalize.js";
export async function capturePi(options:{sessionId:string;cwd?:string;executable?:string;piHome?:string;leafId?:string;maxCaptureBytes?:number},signal?:AbortSignal):Promise<CaptureResult>{
  const cwd=resolve(options.cwd??process.cwd());const h=await resolveHarness("pi",options.executable);
  const versionResult=await runProcess({executable:h.executable,args:[...h.argsPrefix,"--version"],cwd,timeoutMs:5000,maxOutputBytes:16384},signal);
  const version=versionResult.stdout.trim();if(versionResult.exitCode!==0)throw new ThreadShiftError("Could not read Pi version", "UNSUPPORTED_RUNTIME");requireCompatibleVersion("pi",version);
  const doc=await readPiSource({...options,cwd},signal);const source:CaptureResult["source"]={harness:"pi",runtimeVersion:version,sessionId:String(doc.header.id),workingDirectory:String(doc.header.cwd),captureMechanism:"jsonl-selected-branch",selection:doc.selection};
  const prefix=`pi/session/${source.sessionId}/`;const rawRecords:RawRecord[]=[{id:"pi-header",value:doc.header,sourceLocator:prefix+"header"},...doc.entries.map(e=>({id:`pi-${e.id}`,value:e,sourceLocator:prefix+`entry/${e.id}`}))];
  const normalized=normalizePi(rawRecords);projectPiContext(rawRecords,source);
  return sanitizeCapture({source,...normalized,rawRecords,completeness:doc.completeness,warnings:[...doc.warnings,...normalized.warnings],sourceDigest:"pending",exclusions:doc.exclusions});
}
