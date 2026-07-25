import type { ReactElement } from "react";
import { useChatBlocked } from "@/host/use-chat-blocked";

interface BlockedViewProps {
  readonly epicId: string;
  readonly chatId: string;
}

// Shows what a chat is waiting on and lets you reply. Approvals get
// Approve/Reject buttons (approvalDecision); interviews are shown read-only
// until transcript-block resolution + interviewAnswer land in a later slice.
export function BlockedView({ epicId, chatId }: BlockedViewProps): ReactElement {
  const { status, blocked, decide } = useChatBlocked(epicId, chatId);

  if (status === "unconfigured") {
    return <p>Set the host env vars to connect.</p>;
  }

  return (
    <section>
      <p>
        Connection: <strong>{status}</strong>
      </p>
      {blocked.length === 0 ? (
        <p>Nothing waiting on you.</p>
      ) : (
        <ul>
          {blocked.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              {item.title}
              {item.kind === "approval" ? (
                <>
                  {" "}
                  <button type="button" onClick={() => decide(item.id, true)}>
                    Approve
                  </button>{" "}
                  <button type="button" onClick={() => decide(item.id, false)}>
                    Reject
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
