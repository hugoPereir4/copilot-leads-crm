import type { QualificationConfig } from "../../../config/qualification.js";
import type { BusinessProfile } from "../../business-profile/contracts/business-profile.js";
import { QualificationError, failedQualification, type LeadQualifier } from "../contracts/qualification.js";
import { buildQualificationInput, evaluateQualification } from "./qualification-rules.js";
import type { QualificationExecutionStore, QualificationWork } from "./qualification-execution-store.js";

export class QualifyMessage {
  constructor(private readonly store: QualificationExecutionStore, private readonly qualifier: LeadQualifier,
    private readonly config: Pick<QualificationConfig, "timeoutMs" | "maxContextChars">) {}

  async execute(work: QualificationWork, profile: BusinessProfile): Promise<void> {
    const reservation = await this.store.begin(work, this.qualifier.source);
    if (reservation.status === "ignorada") return;
    let result = failedQualification(reservation.source);
    let errorCode: import("../contracts/qualification.js").QualificationFailureCode | null = "interrupted";
    if (reservation.status === "reservada") {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        let input;
        try { input = buildQualificationInput(work.context.message.body!, reservation.previousMessages, profile, this.config.maxContextChars); }
        catch { throw new QualificationError("context_limit"); }
        const timedOut = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => { controller.abort(); reject(new QualificationError("timeout")); }, this.config.timeoutMs);
        });
        const raw = await Promise.race([this.qualifier.qualify(input, controller.signal), timedOut]);
        try { result = evaluateQualification(raw, input, reservation.source); }
        catch { throw new QualificationError("invalid_output"); }
        errorCode = null;
      } catch (error) {
        errorCode = error instanceof QualificationError ? error.code : "qualifier_failure";
      } finally { if (timeout) clearTimeout(timeout); }
    }
    // Somente esta transação aplica campos/estado e conclui o job.
    await this.store.finish(work, result, errorCode);
  }
}
