import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { AgentChat } from "@/components/agent/agent-chat";

export const metadata = { title: "Ask ShiftSync · ShiftSync AI" };

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        title="Ask ShiftSync"
        description="Voice-enabled, read-only copilot grounded in saved incidents and confirmed handovers."
      />
      <PageBody>
        <AgentChat />
      </PageBody>
    </>
  );
}
