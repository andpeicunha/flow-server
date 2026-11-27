import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pane = resolve('herdr/pane.mjs');

async function launch(configPath, input = '', homeDir) {
  const child = spawn(process.execPath, [pane], {
    env: { ...process.env, ...(homeDir ? { HOME: homeDir } : {}), FLOW_SOURCE_CONFIG: configPath }, stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.end(input);
  const status = await new Promise((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(new Error('plugin setup timed out')); }, 5000);
    child.on('error', fail);
    child.on('close', code => { clearTimeout(timer); done(code); });
  });
  return { status, stdout, stderr };
}

const flow = (skills = []) => JSON.stringify({ schemaVersion: 'v1', id: 'sample', nodes: [{ id: 'work', skills }] });
const source = (dir, policy) => ({ schemaVersion: 'v1', sources: [{
  id: 'personal', mode: 'local', path: dir, sync: { pull: 'confirm', push: 'manual' }, policy
}] });

for (const scenario of [
  { name: 'invalid policy syntax', policy: { skills: ['!blocked*'] }, skills: [], expected: /Invalid tool policy/ },
  { name: 'denied node skill after update', policy: { skills: ['*', '!blocked*'] }, skills: ['blocked-tool'], expected: /FLOW_TOOL_POLICY_DENIED|blocked-tool/ }
]) {
  test(`plugin startup diagnoses ${scenario.name} without rewriting source files`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flow-plugin-policy-'));
    try {
      const configPath = join(dir, 'sources.json');
      const flowDir = join(dir, 'flows');
      await mkdir(flowDir);
      await writeFile(join(flowDir, 'sample.json'), flow(scenario.skills));
      const original = JSON.stringify(source(flowDir, scenario.policy));
      await writeFile(configPath, original);
      const result = await launch(configPath);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
      if (scenario.skills.length) {
        assert.match(result.stderr, /Profile personal, flow sample, node work/);
        assert.match(result.stderr, /blocked-tool/);
      }
      assert.equal(await readFile(configPath, 'utf8'), original);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('first use asks for a source and does not create one without confirmation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flow-plugin-first-use-'));
  try {
    const configPath = join(dir, 'sources.json');
    const result = await launch(configPath, '');
    assert.match(result.stdout, /No local flow source is configured/);
    await assert.rejects(readFile(configPath), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a second machine-style installation reports the denied node and leaves its files intact', async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'flow-plugin-second-machine-'));
  try {
    const flowDir = join(homeDir, 'flows');
    await mkdir(flowDir);
    const flowPath = join(flowDir, 'sample.json');
    const configPath = join(homeDir, 'sources.json');
    const originalFlow = flow(['blocked-tool']);
    const originalConfig = JSON.stringify(source(flowDir, { skills: ['*', '!blocked*'] }));
    await writeFile(flowPath, originalFlow);
    await writeFile(configPath, originalConfig);
    const result = await launch(configPath, '', homeDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Profile personal, flow sample, node work: skills tool blocked-tool denied/);
    assert.equal(await readFile(flowPath, 'utf8'), originalFlow);
    assert.equal(await readFile(configPath, 'utf8'), originalConfig);
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});
