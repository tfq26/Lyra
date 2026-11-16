/**
 * Lyra User Feedback & Autonomous Self-Evolution Service (`server/userFeedbackService.ts`)
 *
 * Captures user feedback on UI/UX or core behavior, treats it as the highest-priority
 * engineering requirement (P0), writes structured backlog tickets, and can trigger
 * the autonomous swarm to repair or enhance Lyra with zero manual developer coding.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface UserFeedbackPayload {
  description: string;
  category?: 'ui-bug' | 'feature-request' | 'layout-polish' | 'behavior';
  url?: string;
  autoDispatch?: boolean;
}

export interface UserFeedbackTicket {
  id: string;
  priority: 'P0_USER_FEEDBACK';
  category: string;
  description: string;
  createdAt: string;
  status: 'pending' | 'in-progress' | 'completed';
  filePath: string;
  autoDispatch: boolean;
}

export class UserFeedbackService {
  private readonly feedbackDir: string;

  constructor(workspaceRoot = process.cwd()) {
    this.feedbackDir = path.join(workspaceRoot, '.lyra', 'backlog', 'user-feedback');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.feedbackDir)) {
      fs.mkdirSync(this.feedbackDir, { recursive: true });
    }
  }

  /**
   * Records user feedback as a top-priority P0 ticket.
   */
  public submitFeedback(payload: UserFeedbackPayload): UserFeedbackTicket {
    this.ensureDir();
    const id = `FEEDBACK-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const category = payload.category || 'ui-bug';
    const autoDispatch = payload.autoDispatch ?? true;

    const safeTitle = payload.description
      .slice(0, 40)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'user-request';

    const fileName = `${id}-${safeTitle}.md`;
    const filePath = path.join(this.feedbackDir, fileName);

    const content = `# User Feedback Ticket: ${id}

- **Ticket ID:** \`${id}\`
- **Priority:** \`P0_USER_FEEDBACK (HIGHEST PRIORITY)\`
- **Category:** \`${category}\`
- **Submitted:** ${timestamp}
- **Status:** \`pending\`

---

## 1. User Statement & Problem Description
> "${payload.description}"

---

## 2. Autonomous Swarm Execution Directive
This feedback represents direct human instruction and must supersede background scans.

### Target Files:
- UI layout/styles: \`src/\`, \`src/components/\`, \`src/index.css\`
- Server/logic: \`server/\`

### Verification Requirements:
\`\`\`bash
bun run build && bun test
\`\`\`

---

## 3. Autonomous Dispatch Command
\`\`\`bash
bun scripts/lyra-dispatch.ts --prompt "Fix user feedback ${id}: ${payload.description.replace(/"/g, '\\"')}" --workers strands
\`\`\`
`;

    fs.writeFileSync(filePath, content, 'utf8');

    return {
      id,
      priority: 'P0_USER_FEEDBACK',
      category,
      description: payload.description,
      createdAt: timestamp,
      status: 'pending',
      filePath,
      autoDispatch,
    };
  }

  /**
   * Lists all recorded user feedback tickets.
   */
  public listFeedback(): UserFeedbackTicket[] {
    this.ensureDir();
    const files = fs.readdirSync(this.feedbackDir).filter((f) => f.endsWith('.md'));
    const tickets: UserFeedbackTicket[] = [];

    for (const f of files) {
      try {
        const fullPath = path.join(this.feedbackDir, f);
        const text = fs.readFileSync(fullPath, 'utf8');
        const idMatch = text.match(/- \*\*Ticket ID:\*\* `([^`]+)`/);
        const descMatch = text.match(/## 1\. User Statement & Problem Description\s+>\s+"([^"]+)"/);
        const createdMatch = text.match(/- \*\*Submitted:\*\* (.*)/);

        if (idMatch) {
          tickets.push({
            id: idMatch[1],
            priority: 'P0_USER_FEEDBACK',
            category: 'ui-bug',
            description: descMatch ? descMatch[1] : '',
            createdAt: createdMatch ? createdMatch[1].trim() : '',
            status: 'pending',
            filePath: fullPath,
            autoDispatch: true,
          });
        }
      } catch {
        // Skip unparseable files
      }
    }

    return tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const userFeedbackService = new UserFeedbackService();
