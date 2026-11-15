import { get } from '@/client';
import { readEnvelopeMode } from '../authority/envelopeMode';

import type { NativeWriteStatusResponse } from './types';

/**
 * Operational status endpoints. Not under the /v1
 * prefix.
 */
export const statusApi = {
  /**
   * Read the node's effective native write mode. Check
   * this before switching between the v2 and legacyV1
   * surfaces -- never probe by submitting, because a
   * retry under the other scheme creates a second
   * transaction on the same nonce.
   *
   * The capability counts are a recent observation, not
   * an instantaneous one: a validator that stops
   * broadcasting can still be counted for roughly 150
   * seconds.
   */
  getNativeWriteStatus: () =>
    get<'custom', NativeWriteStatusResponse>(
      '/api/status',
      { withCredentials: false }
    ),

  /**
   * Read the node's token authority envelope mode. Never throws
   * for a node answer: anything but a reported `upgrade_gap` or
   * `settled` reads as `legacy`, with the reason.
   */
  getEnvelopeMode: readEnvelopeMode,

  /**
   * Node health probe. Returns the plain-text body (e.g.
   * "UP"), not JSON.
   */
  getHealth: () =>
    get<'custom', string>('/api/health', {
      withCredentials: false,
      responseType: 'text'
    })
};

export default statusApi;
