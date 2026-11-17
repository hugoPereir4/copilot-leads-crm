import type { LeadQualification, QualificationSource } from "@copilot-leads/shared";
import type { ClaimedJob } from "../../jobs/application/job-queue.js";
import type { MessageProcessingContext } from "../../messaging/contracts/message-processing-context.js";
import type { QualificationFailureCode } from "../contracts/qualification.js";

export type QualificationWork = { job: ClaimedJob; context: MessageProcessingContext };
export type QualificationReservation = { status: "reservada" | "interrompida"; source: QualificationSource; previousMessages: string[] } | { status: "ignorada" };
export interface QualificationExecutionStore {
  begin(work: QualificationWork, source: QualificationSource): Promise<QualificationReservation>;
  finish(work: QualificationWork, result: LeadQualification, errorCode: QualificationFailureCode | null): Promise<void>;
}
