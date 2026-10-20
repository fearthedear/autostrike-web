const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');

async function loadModule() {
  const source = await readFile(new URL('../functions/join.js', `file://${__filename}`), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('game invite web fallback redirects to the real App Store listing without sharing the game code', async () => {
  const { onRequestGet } = await loadModule();
  const response = onRequestGet({ request: new Request('https://autostrikegolf.com/join?code=A4AAB7021E201620CF4CF8E5E87D43B9') });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://apps.apple.com/app/autostrike-golf/id6762587973');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('invalid or ambiguous game invites do not redirect', async () => {
  const { onRequestGet } = await loadModule();
  for (const query of ['', '?code=bad!', '?code=ABC234&code=DEF567', '?other=ABC234']) {
    const response = onRequestGet({ request: new Request(`https://autostrikegolf.com/join${query}`) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
  }
});

test('only game invite paths are associated with the iOS app', async () => {
  const association = JSON.parse(await readFile(new URL('../.well-known/apple-app-site-association', `file://${__filename}`), 'utf8'));
  assert.deepEqual(association.applinks.details, [{
    appID: '42KEMQFNTJ.com.autostrikegroup.autostrikegolf',
    paths: ['/join', '/join/'],
  }]);
});
