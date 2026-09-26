import type { Message, ToolExecution } from '../shared/protocol';

/** The only boundary that needs adapting when the service contract is supplied. */
export interface CopilotProvider {
  readonly available: boolean;
  readonly name: string;
  generate(input: {
    conversationId: string;
    requestId: string;
    messages: Message[];
    signal: AbortSignal;
    onTool: (tool: ToolExecution) => void;
    onText: (text: string) => void;
  }): Promise<string>;
}

export class UnconfiguredProvider implements CopilotProvider {
  available = false;
  name = 'Not connected';
  async generate(): Promise<string> {
    throw new Error('SERVICE_NOT_CONFIGURED');
  }
}

export function publicGenerationError(error: unknown): string {
  if (error instanceof Error && error.message === 'SERVICE_NOT_CONFIGURED') {
    return 'The AI service is not connected yet. Your message is saved; retry after the service is configured.';
  }
  return 'The response could not be completed. Your messages are saved. Please try again.';
}
