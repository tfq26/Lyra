import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import { UserFeedbackService } from './userFeedbackService';

describe('User Feedback Service (P0 Priority Queue)', () => {
  const tempDir = `/tmp/lyra-feedback-test-${Date.now()}`;

  it('records user feedback with P0 priority and persists structured markdown', () => {
    const service = new UserFeedbackService(tempDir);
    const ticket = service.submitFeedback({
      description: 'Make the sidebar search bar rounded and increase contrast on active session',
      category: 'layout-polish',
      autoDispatch: true,
    });

    expect(ticket.id).toBeDefined();
    expect(ticket.priority).toBe('P0_USER_FEEDBACK');
    expect(fs.existsSync(ticket.filePath)).toBe(true);

    const content = fs.readFileSync(ticket.filePath, 'utf8');
    expect(content).toContain('P0_USER_FEEDBACK');
    expect(content).toContain('Make the sidebar search bar rounded');
    expect(content).toContain('bun run build && bun test');

    const list = service.listFeedback();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(ticket.id);
  });
});
