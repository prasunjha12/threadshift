import type { Event, HandoffState, ThreadShiftBundle, Warning } from "../core/types.js";
import { projectPiContext } from "../adapters/pi/normalize.js";
import { deriveHandoff } from "./handoff.js";
export function getEffectiveContext(bundle:ThreadShiftBundle):{events:Event[];handoff:HandoffState;omittedEventIds:string[];editedEventIds:string[];warnings:Warning[]}{
  if(bundle.source.harness!=="pi")return {events:bundle.history.events,handoff:bundle.handoff,omittedEventIds:[],editedEventIds:[],warnings:[]};
  const projected=projectPiContext(bundle.history.rawRecords,bundle.source);
  const handoff=deriveHandoff({events:projected.events},{...bundle.workspace,git:bundle.git,warnings:[]});
  const changed=new Set([...projected.omittedEventIds,...projected.editedEventIds]);const present=new Set(projected.events.map(e=>e.id));
  const safe=(e:{origin:string;eventIds:string[]})=>e.origin==="user-supplied"&&e.eventIds.length===0 || e.eventIds.length>0&&e.eventIds.every(id=>present.has(id)&&!changed.has(id));
  for(const key of ["objective","currentState"]as const){const supplied=bundle.handoff[key];if(supplied?.origin==="user-supplied"&&supplied.eventIds.length===0)handoff[key]=supplied;}
  for(const key of ["completed","decisions","remaining","blockers","nextActions","importantFiles","verificationState","activePlan"]as const)handoff[key]=bundle.handoff[key].filter(safe);
  return {...projected,handoff};
}
