import {
  accountFlowIdFromUrl,
  type AccountFlowState,
  type ActiveAccountFlowState,
  completeAccountFlowLocalPassword,
  defaultProfileValue,
  flowKindLabel,
  formatAccountFlowError,
  hasLocalProvider,
  loadAccountFlowState,
  type LocalPasswordInput,
  type LocalPasswordSuccess,
  parseAccountFlowState,
  unavailableProviders,
} from "../../account_flow_state.ts";

export {
  accountFlowIdFromUrl,
  completeAccountFlowLocalPassword,
  defaultProfileValue,
  flowKindLabel,
  formatAccountFlowError,
  hasLocalProvider,
  loadAccountFlowState,
  parseAccountFlowState,
  unavailableProviders,
};
export type {
  AccountFlowState,
  ActiveAccountFlowState,
  LocalPasswordInput,
  LocalPasswordSuccess,
};

/** Whether this portal route is intended for the loaded active flow. */
export function isExpectedPasswordFlow(state: ActiveAccountFlowState): boolean {
  return state.kind === "local_password_reset";
}

/** Primary heading for password reset flows. */
export function passwordFlowTitle(kind: string): string {
  if (kind === "local_password_reset") return "Reset your password";
  return "Set local credentials";
}

/** Submit button text for password reset flows. */
export function passwordFlowAction(kind: string): string {
  if (kind === "local_password_reset") return "Reset password";
  return "Save credentials";
}
