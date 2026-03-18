import { NextRequest, NextResponse } from 'next/server';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL?.trim();

export async function POST(request: NextRequest) {
  if (!SLACK_WEBHOOK_URL) {
    return NextResponse.json({ error: 'SLACK_WEBHOOK_URL not configured' }, { status: 500 });
  }

  try {
    const { completed, failed, total } = await request.json();

    const lines = [`*Batch Output Complete*`];
    lines.push(`${completed} completed, ${failed} failed (${total} total)`);

    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Slack responded ${res.status}: ${text}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[slack-notify] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
