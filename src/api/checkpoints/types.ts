// Types for checkpoint API
import { B256Schema } from '../types';
import type { Transaction, TransactionReceipt } from '../transactions/types';

// Response type for checkpoint number endpoint
export interface CheckpointNumberResponse {
  number: number;
}

// Re-export Transaction type for backward compatibility
export type { Transaction };

// Header type for checkpoint responses
export interface Header {
  hash: B256Schema;
  parent_hash: B256Schema;
  state_root: B256Schema;
  transactions_root: B256Schema;
  receipts_root: B256Schema;
  number: number;
  timestamp: number;
  extra_data: string;
}

// Checkpoint response type
export interface Checkpoint extends Header {
  size?: number;
  transactions: Transaction[] | B256Schema[];
}

// Checkpoint receipts type
export type CheckpointReceipts = TransactionReceipt[];
