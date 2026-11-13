/**
 * Authoring-run accounting constants shared by the ledger and the trial budget.
 *
 * Kept import-free so both modules can use them without a cycle: the ledger
 * imports the trial transaction, so the trial module may not import the ledger.
 */

/** Review calls admitted per run after the initial generation call. */
export const AUTHORING_RUN_REVIEW_SLOTS = 3;

/**
 * Inference calls one free authoring run can make: the initial generation plus
 * every review slot. The shared daily ceiling must reserve the full maximum,
 * otherwise a run that uses all of its slots would be under-charged.
 */
export const FREE_AUTHORING_GLOBAL_UNITS = 1 + AUTHORING_RUN_REVIEW_SLOTS;
