import { useEffect, useRef } from 'react';

/** Subscribes to a server-sent event stream for the component's lifetime; each message arrives JSON-parsed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the streams carry a different shape per message type
export function useEventSource(url: string, onMessage: (data: any) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    const source = new EventSource(url);
    source.onmessage = (event) => handler.current(JSON.parse(event.data));
    return () => source.close();
  }, [url]);
}
