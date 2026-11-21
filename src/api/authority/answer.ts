import { get } from '@/client';
import { ownMember } from '../problem';

// `get` resolves instead of rejecting when a global onError is
// configured, so a value and a read error both arrive here as the
// answer. A rejection with one of `quietStatuses` is an expected
// answer: the client logs no error for it.
export async function readAnswer(
  url: string,
  quietStatuses?: readonly number[]
): Promise<unknown> {
  try {
    return await get<'custom', unknown>(url, {
      withCredentials: false,
      quietStatuses
    });
  } catch (caught) {
    return caught;
  }
}

// The client's ParsedError: a numeric status and a name.
export function isReadError(answer: unknown): boolean {
  return (
    typeof ownMember(answer, 'status') === 'number' &&
    typeof ownMember(answer, 'name') === 'string'
  );
}

/**
 * The HTTP status a node answered with, or undefined when no answer
 * came. The client gives a network error or a timeout status 500
 * with no `data`; a node's own answer always carries a body.
 */
export function answeredStatus(
  answer: unknown
): number | undefined {
  const status = ownMember(answer, 'status');
  return isReadError(answer) &&
    ownMember(answer, 'data') !== undefined &&
    Number.isInteger(status) &&
    (status as number) >= 100 &&
    (status as number) <= 599
    ? (status as number)
    : undefined;
}

export function wholeNumber(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}
