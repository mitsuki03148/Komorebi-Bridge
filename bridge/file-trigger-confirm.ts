/** Handle a digest-bound, one-time confirmation and publish the result to every connected view. */
export function confirmFileTrigger(options: {
  digest: string;
  groupIds: () => string[];
  confirm: (digest: string) => boolean;
  onAccepted: () => void;
  publish: (groupId: string) => void;
  onRejected: () => void;
}) {
  const accepted = options.confirm(options.digest);
  try { if (accepted) options.onAccepted(); }
  finally { for (const groupId of options.groupIds()) options.publish(groupId); }
  if (!accepted) options.onRejected();
  return accepted;
}
