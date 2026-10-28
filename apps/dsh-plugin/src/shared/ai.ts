/** Structural boundary to the verified DSH Session and scoped tool APIs. */
export type { AiOfficeEditProjection as VisibleOfficeEdit } from '@easyview/contracts';
export interface ModelCatalog {
  default: { provider: string; model: string } | null;
  groups: Array<{ id: string; models: Array<{ id: string }> }>;
}
export interface SessionEvent { type: string; data: Record<string, any> }
export interface SessionFrame {
  type: string; event?: SessionEvent; records?: Array<{ event: SessionEvent }>;
  frame?: { type: string; turn?: number; attemptId: string; index?: number; chunk?: Record<string, any> };
}
export interface DshSessions {
  modelCatalog(): Promise<ModelCatalog>;
  create(input: { workspaceId: string; agentPreset: string; sessionId?: string }): Promise<{ sessionId: string; agentPreset?: string }>;
  selectSessionModel(input: { sessionId: string; provider: string; model: string }): Promise<unknown>;
  prompt(input: { sessionId: string; requestId: string; mode: 'queue'; content: Array<{ type: 'text'; text: string }>; clientTimeZone: string }, signal: AbortSignal): Promise<unknown>;
  follow(input: { address: { kind: 'session'; sessionId: string }; maxMessages: number; assistantStream: true }, signal: AbortSignal): AsyncIterable<SessionFrame>;
  cancel(input: { sessionId: string }): Promise<unknown>;
  inspect?(sessionId: string): Promise<{ events: readonly SessionEvent[] }>;
}
export interface AiExecution { signal: AbortSignal; callId: string; agent?: { id: string } }
export interface AiToolDefinition {
  name: string; description: string; parameters: Record<string, unknown>;
  output: { schema: { type: 'string' }; render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }> };
  execute(args: unknown, execution: AiExecution): Promise<string>;
}
export interface AiTools {
  restrict(filter: { allow?: string[]; deny?: string[] }): unknown;
  presentAs(mode: 'native'): unknown;
  register(tool: AiToolDefinition): unknown;
  schemas(agent?: object): Array<{ name: string }>;
  guard(check: (execution: AiExecution & { name: string }) => string | undefined): unknown;
}
export const AI_PRESETS = { chat: 'easyview-chat-v1', agent: 'easyview-agent-v1' } as const;
export interface AiAddress { workbenchId: string; workspaceId: string; documentId?: string; generation?: string }
export const AI_TOOLS = { chat: ['easyview_read_document'], agent: ['easyview_read_document', 'easyview_edit_markdown', 'easyview_create_markdown', 'easyview_edit_workbook'] };
export interface VisibleAiMessage {
  officeEdits?: import('@easyview/contracts').AiOfficeEditProjection[];
  toolCalls?: Array<{ id: string; name: string; done: boolean }>;
  id: string; role: 'user' | 'assistant'; content: string; requestId: string;
  error?: string; badge?: 'error' | 'applied' | 'stopped';
}
