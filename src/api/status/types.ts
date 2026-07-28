// GET /api/status. These endpoints sit outside the /v1
// prefix.

export type NativeWriteMode =
  | 'v1_only'
  | 'dual'
  | 'v2_only';

export type ActivationSource =
  | 'not_activated'
  | 'capability_full'
  | 'binary_release';

export interface FeatureSupportStatus {
  support_count: number;
  required_count: number;
  full_support: boolean;
}

export interface NativeWriteStatusResponse {
  native_write_mode: NativeWriteMode;
  // true means the node rejects every native write route
  // (the archive read-only profile) and never activates
  // dual.
  read_only: boolean;
  activation_source: ActivationSource;
  dual_activated_at_secs: number | null;
  native_domain_separated_transactions:
    FeatureSupportStatus;
}
