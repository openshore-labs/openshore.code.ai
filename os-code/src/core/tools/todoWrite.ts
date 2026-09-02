// The agent's task list. Claude Code's most visible affordance: for any job
// with more than a few steps the model writes its plan as a checklist, marks
// each item in progress as it starts and completed as it lands, and the UI
// shows the list with a progress count. The tool itself just validates and
// echoes; the loop mirrors every call as a `todos` event (see loop.ts).
import { z } from 'zod';
import type { ToolDef } from './index.js';

export const todoSchema = z.object({
  items: z
    .array(
      z.object({
        content: z.string().min(1).describe('One step, imperative, specific'),
        status: z.enum(['pending', 'in_progress', 'completed']),
      }),
    )
    .max(40)
    .describe('The whole list, replaced each call. Keep at most one item in_progress.'),
});

export const todoWriteTool: ToolDef<typeof todoSchema> = {
  name: 'todoWrite',
  description:
    'Write or update your task list for this job. Send the WHOLE list each time (it replaces the last one). Use it for any task with three or more steps: write the plan up front, mark one item in_progress when you start it, and completed the moment it lands. The person sees this list live.',
  schema: todoSchema,
  risk: 'read',
  async execute(args) {
    const done = args.items.filter((i) => i.status === 'completed').length;
    const active = args.items.find((i) => i.status === 'in_progress');
    return {
      ok: true,
      content: `Task list updated: ${done}/${args.items.length} done${active ? `, working on: ${active.content}` : ''}.`,
    };
  },
};
