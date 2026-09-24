// Confirm copy shared across rooms, so one kind of loss reads the same way
// wherever it is asked.

/** The confirm for forgetting a current's device connection: the question as
 *  the card's heading, the reach of it underneath. */
export function forgetCurrentCopy(label: string): { title: string; body: string } {
  return {
    title: `Forget ${label} on this device?`,
    body: 'It turns off in every project that uses it, and its API key is removed.',
  };
}
