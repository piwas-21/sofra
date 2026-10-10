/** Existing branch/PR state must be resolved before different details are proposed. */
export class PartnerBrandProposalConflictError extends Error {
  constructor(message: string, readonly prUrl?: string) {
    super(message);
    this.name = "PartnerBrandProposalConflictError";
  }
}
