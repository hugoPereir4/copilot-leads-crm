import type { Pool } from "pg";
import type { DemoConversation, DemoMessage } from "@copilot-leads/shared";
import type { DemoReadModel } from "../../modules/simulator/application/demo-read-model.js";

export class PostgresDemoReadModel implements DemoReadModel {
  constructor(private readonly pool: Pool) {}
  async conversations(): Promise<DemoConversation[]> {
    return (await this.pool.query<DemoConversation>(`
      SELECT c.id, p.phone, p.display_name AS "contactName", c.status,
        (SELECT count(*)::integer FROM public.jobs j JOIN public.messages m ON m.id = j.message_id
          WHERE m.conversation_id = c.id AND j.status = 'falhou') AS "failedJobs",
        CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('id', l.id, 'stage', l.stage,
          'needsReview', l.needs_review, 'summary', l.summary, 'qualification', COALESCE(l.qualification,
            (SELECT jsonb_build_object('intent', NULL, 'serviceId', NULL, 'serviceName', NULL, 'period', NULL, 'summary', NULL,
              'needsReview', l.needs_review, 'source', q.source, 'status', 'processando') FROM public.qualification_runs q
              WHERE q.conversation_id = c.id AND q.status = 'processando' ORDER BY q.created_at DESC, q.message_id DESC LIMIT 1))) END AS lead
      FROM public.conversations c JOIN public.contacts p ON p.id = c.contact_id
      LEFT JOIN public.leads l ON l.conversation_id = c.id
      WHERE EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id AND m.provider = 'simulador')
      ORDER BY c.created_at DESC, c.id LIMIT 100;
    `)).rows;
  }
  async messages(conversationId: string): Promise<DemoMessage[]> {
    const rows = await this.pool.query<Omit<DemoMessage, "createdAt"> & { createdAt: Date }>(`
      SELECT id, direction, sender_type AS "senderType", kind, body, created_at AS "createdAt"
      FROM (SELECT m.*, COALESCE(b.position, 0) AS block_position FROM public.messages m
        LEFT JOIN public.response_blocks b ON b.sent_message_id = m.id
        WHERE m.conversation_id = $1 AND m.provider = 'simulador'
        ORDER BY m.created_at DESC, block_position DESC, m.id DESC LIMIT 500) recent
      ORDER BY created_at, block_position, id;
    `, [conversationId]);
    return rows.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}
