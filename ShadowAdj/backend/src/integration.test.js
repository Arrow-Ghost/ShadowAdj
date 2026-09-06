import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from './index.js';

test('End-to-End Server & WebSocket Integration', async (t) => {
  // Start server on an ephemeral port
  process.env.PORT = '0';
  const server = await startServer(0);
  const address = server.address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test('GET /health and GET /api/health return status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok('geminiEnabled' in body);

    const resApi = await fetch(`${baseUrl}/api/health`);
    assert.equal(resApi.status, 200);
    const bodyApi = await resApi.json();
    assert.equal(bodyApi.ok, true);
  });

  let sessionId = '';
  await t.test('POST /api/sessions creates session with consent record', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'debate-practice',
        label: 'Integration Test Session',
        consent: { speakerAcknowledged: true, secondPartyAcknowledged: true },
        transcriptSource: 'server',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    sessionId = body.id;
    assert.equal(body.wsUrl, `/ws?sessionId=${body.id}`);
  });

  await t.test('GET /api/sessions/:id/consent returns consent record', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/consent`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.speakerAcknowledged, true);
    assert.ok(body.timestamp);
  });

  await t.test('WebSocket streaming with framed audio chunks', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sessionId=${sessionId}`);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const receivedTicks = [];
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'tick') {
          receivedTicks.push(msg);
        }
      } catch {}
    });

    // Send ping
    ws.send(JSON.stringify({ type: 'ping' }));

    // Send a framed audio chunk (20-byte 'SHAD' header)
    // 0..3: 'SHAD'
    // 4..7: seq=1
    // 8..11: chunkId=1
    // 12..19: timestampMs=100.0 (double)
    const header = Buffer.alloc(20);
    header.write('SHAD', 0, 4, 'ascii');
    header.writeUInt32BE(1, 4);
    header.writeUInt32BE(1, 8);
    header.writeDoubleBE(100.0, 12);

    // Audio payload: 1600 samples of 16kHz 16-bit PCM
    const pcm = Buffer.alloc(3200);
    const packet = Buffer.concat([header, pcm]);

    ws.send(packet);

    // Send question marker
    ws.send(JSON.stringify({ type: 'question', label: 'Point of information' }));

    // Wait for tick emission (fires every 500ms)
    await new Promise((r) => setTimeout(r, 750));

    assert.ok(receivedTicks.length > 0, 'Should receive at least one tick');
    const latest = receivedTicks[receivedTicks.length - 1];
    assert.ok(latest.snapshot);
    assert.ok('currentWpm' in latest.snapshot.pace);
    assert.ok('rollingWpm' in latest.snapshot.pace);

    // Send end message
    ws.send(JSON.stringify({ type: 'end' }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
  });

  await t.test('POST /api/sessions/:id/coaching returns structured coaching', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/coaching`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.notes);
    assert.ok(body.experiment, 'Should include single recommended experiment');
    assert.ok(body.experiment.title);
    assert.ok(body.experiment.description);
    assert.ok(body.experiment.metricTarget);
  });

  await t.test('DELETE /api/sessions/:id permanently removes session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.deleted, true);

    // Verify session is removed
    const check = await fetch(`${baseUrl}/api/sessions/${sessionId}/consent`);
    assert.equal(check.status, 404);
  });
});
