#!/usr/bin/env python3
"""Agent Town бұлт worker-і (VPS хостында, systemd `agent-town-cloud`).

Ноутбук офлайн болғанда relay бұлт командаларын осында береді:
  * new (engine=cloud) → жоба үшін «бос» git папкасы (тек origin) → cloud_launch.py
  * message (cloudUrl) → claude -p "..." --cloud <url> --output-format json
Бұлттық сессия репоны GitHub-тан өзі клондайды, сондықтан VPS-ке GitHub
рұқсаты керек емес. Тәуелділіксіз (stdlib).
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error

RELAY = os.environ.get('RELAY_URL', 'http://127.0.0.1:3020').rstrip('/')
TOKEN = os.environ['BRIDGE_TOKEN']
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('DATA_DIR', '/opt/agent-town/data')
REPOS = os.environ.get('REPOS_DIR', '/opt/agent-town/repos')
CLAUDE = os.environ.get('CLAUDE_BIN', '/root/.local/bin/claude')
SESS_FILE = os.path.join(DATA, 'vps-cloud.json')
GH = re.compile(r'^(?:https://github\.com/|git@github\.com:)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$')


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def req(method, path, body=None, timeout=35):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(RELAY + path, data=data, method=method, headers={
        'authorization': 'Bearer ' + TOKEN, 'content-type': 'application/json', 'x-role': 'cloud'})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def load_sessions():
    try:
        with open(SESS_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def save_sessions(lst):
    lst = [s for s in lst if time.time() * 1000 - s.get('lastAt', 0) < 3 * 864e5][:12]
    with open(SESS_FILE, 'w') as f:
        json.dump(lst, f, ensure_ascii=False, indent=1)
    return lst


_auth = {'at': 0, 'ok': False}
def logged_in():
    if time.time() - _auth['at'] > 60:
        try:
            out = subprocess.run([CLAUDE, 'auth', 'status'], capture_output=True, text=True, timeout=20).stdout
            _auth['ok'] = bool(json.loads(out).get('loggedIn'))
        except Exception:
            _auth['ok'] = False
        _auth['at'] = time.time()
    return _auth['ok']


NOT_LOGGED = 'серверде claude аккаунтқа кірмеген: серверде `claude auth login` іске қос'


def stub_repo(remote, branch='main'):
    """origin-ы бар бос git папкасы — `claude --cloud` репоны осыдан таниды."""
    m = GH.match(remote or '')
    if not m:
        raise ValueError('жобаның GitHub remote-ы белгісіз')
    owner, name = m.group(1), m.group(2)
    d = os.path.join(REPOS, f'{owner}__{name}')
    if not os.path.isdir(os.path.join(d, '.git')):
        os.makedirs(d, exist_ok=True)
        run = lambda *a: subprocess.run(['git', '-C', d, *a], check=True, capture_output=True)
        run('init', '-q', '-b', 'main')
        run('remote', 'add', 'origin', f'https://github.com/{owner}/{name}.git')
        run('-c', 'user.name=agent-town', '-c', 'user.email=agent-town@localhost', 'commit', '-q', '--allow-empty', '-m', 'stub')
    subprocess.run(['git', '-C', d, 'checkout', '-q', '-B', branch], check=True, capture_output=True)
    return d, name


def do_new(cmd):
    if not logged_in():
        return {'ok': False, 'message': NOT_LOGGED}
    d, name = stub_repo(cmd.get('remote'), cmd.get('branch') or 'main')
    env = {**os.environ, 'CLAUDE_BIN': CLAUDE, 'CLOUD_TIMEOUT': '150'}
    p = subprocess.run([sys.executable, os.path.join(HERE, 'cloud_launch.py'), cmd['text']], cwd=d, env=env,
                       capture_output=True, text=True, timeout=200)
    url = next((l[4:].strip() for l in p.stdout.splitlines() if l.startswith('URL ')), None)
    if not url:
        logs = ' '.join(l[4:] for l in p.stdout.splitlines() if l.startswith('LOG '))[-300:]
        return {'ok': False, 'message': 'бұлттық сессия ашылмады: ' + (logs or p.stderr[-200:] or 'белгісіз')}
    lst = load_sessions()
    now = int(time.time() * 1000)
    lst.insert(0, {'id': cmd['id'], 'url': url, 'cwd': cmd.get('cwd'), 'project': name, 'text': cmd['text'][:200],
                   'startedAt': now, 'lastAt': now, 'via': 'vps'})
    save_sessions(lst)
    return {'ok': True, 'message': f'бұлттық сессия ашылды (VPS): {name}', 'url': url}


def do_message(cmd):
    if not logged_in():
        return {'ok': False, 'message': NOT_LOGGED}
    url = cmd['cloudUrl']
    lst = load_sessions()
    known = next((s for s in lst if s['url'] == url), None)
    cwd = REPOS
    p = subprocess.run([CLAUDE, '-p', cmd['text'], '--cloud', url, '--output-format', 'json'], cwd=cwd,
                       capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL)
    try:
        j = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        return {'ok': False, 'message': 'claude жауабы түсініксіз: ' + (p.stderr or p.stdout)[-200:]}
    if not j.get('ok'):
        return {'ok': False, 'message': 'бұлт: ' + str(j.get('error'))[:200]}
    if known:
        known['lastAt'] = int(time.time() * 1000); save_sessions(lst)
    return {'ok': True, 'message': 'бұлтқа жіберілді (VPS)'}


def heartbeat():
    # тапсырма орындалып жатса да relay «бұлт дайын» деп көрсетсін
    while True:
        try:
            req('POST', '/bridge/cloudlist', {'sessions': load_sessions(), 'claude': os.path.exists(CLAUDE), 'loggedIn': logged_in()}, timeout=10)
        except Exception:
            pass
        time.sleep(15)


def main():
    os.makedirs(REPOS, exist_ok=True); os.makedirs(DATA, exist_ok=True)
    log('cloud worker →', RELAY)
    import threading; threading.Thread(target=heartbeat, daemon=True).start()
    last_push = time.time()
    while True:
        try:
            if time.time() - last_push > 15:
                req('POST', '/bridge/cloudlist', {'sessions': load_sessions(), 'claude': os.path.exists(CLAUDE), 'loggedIn': logged_in()}, timeout=10)
                last_push = time.time()
            r = req('GET', '/bridge/poll?role=cloud', timeout=35)
            for cmd in (r or {}).get('commands', []):
                try:
                    res = do_new(cmd) if cmd['type'] == 'new' else do_message(cmd) if cmd['type'] == 'message' else {'ok': True, 'message': 'pong vps'}
                except Exception as e:
                    res = {'ok': False, 'message': str(e)[:300]}
                log('cmd', cmd['type'], 'ok' if res['ok'] else 'FAIL', res['message'])
                req('POST', '/bridge/result', {'id': cmd['id'], **res}, timeout=10)
                req('POST', '/bridge/cloudlist', {'sessions': load_sessions(), 'claude': True, 'loggedIn': logged_in()}, timeout=10)
        except (urllib.error.URLError, OSError, ValueError) as e:
            log('байланыс қатесі:', e); time.sleep(5)


if __name__ == '__main__':
    main()
