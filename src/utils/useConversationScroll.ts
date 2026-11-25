import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nearBottom, ownMessageJump, useStayAtBottom } from './scrollFollow';

/**
 * Keeps a conversation pinned to its newest message while the reader is at the bottom. `firstId` is the
 * first message shown: when it changes while the reader is higher up (older messages were loaded above),
 * the scroll position is moved by the added height so what they were reading stays where it is.
 */
export function useConversationScroll(roomId: string | undefined, version: string, firstId?: string, latest?: { id: string; sender: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastHeight = useRef(0);
  const lastFirst = useRef<string | undefined>(undefined);
  const prepended = useRef(false);
  const [away, setAway] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const lastLatest = useRef<string | undefined>(undefined);
  useStayAtBottom(ref, following, roomId);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (lastFirst.current && firstId && firstId !== lastFirst.current && !following.current) {
      element.scrollTop += element.scrollHeight - lastHeight.current;
      prepended.current = true;
    }
    lastFirst.current = firstId;
    lastHeight.current = element.scrollHeight;
  }, [firstId, version]);

  useEffect(() => {
    following.current = true;
    setAway(false);
    setNewMessages(false);
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [roomId]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // What the user just sent takes them to the bottom, even from further up.
    if (ownMessageJump(lastLatest.current, latest) && lastLatest.current !== undefined) following.current = true;
    lastLatest.current = latest?.id;
    if (following.current) element.scrollTop = element.scrollHeight;
    else if (prepended.current) prepended.current = false;
    else setNewMessages(true);
  }, [version]);

  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    lastHeight.current = element.scrollHeight;
    following.current = nearBottom(element);
    setAway(!following.current);
    if (following.current) setNewMessages(false);
  };
  const goToBottom = () => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    following.current = true;
    setAway(false);
    setNewMessages(false);
  };
  return { ref, onScroll, goToBottom, visible: away || newMessages, newMessages };
}
