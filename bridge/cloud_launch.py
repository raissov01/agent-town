#!/usr/bin/env python3
"""`claude --cloud "тапсырма"` командасын жалған TTY ішінде іске қосады.

--cloud интерактивті терминал талап етеді, сондықтан bridge оны тікелей
шақыра алмайды. Бұл скрипт:
  * папкаға сену сұрағына («trust this folder») Enter басады,
  * claude.ai/code/... URL-ін тауып, stdout-қа `URL <url>` деп шығарады,
  * URL шыққан соң (не TIMEOUT өткенде) процесті жабады.
Қолдану: cloud_launch.py "тапсырма мәтіні"   (cwd = жоба папкасы)
"""
import os, pty, re, select, signal, sys, time

TIMEOUT = float(os.environ.get('CLOUD_TIMEOUT', '150'))
ANSI = re.compile(rb'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]')
URL = re.compile(r'https://claude\.ai/code/[A-Za-z0-9_\-]+')


def main():
    if len(sys.argv) < 2:
        print('usage: cloud_launch.py "task"', file=sys.stderr); return 2
    claude = os.environ.get('CLAUDE_BIN', 'claude')
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['COLUMNS'] = '200'; os.environ['LINES'] = '50'
        os.execvp(claude, [claude, '--cloud', sys.argv[1]])
    start = time.time(); buf = ''; answered = set(); url = None; done_at = None
    try:
        while time.time() - start < TIMEOUT:
            r, _, _ = select.select([fd], [], [], 0.5)
            if r:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                text = ANSI.sub(b'', chunk).decode('utf-8', 'replace')
                buf = (buf + text)[-20000:]
                flat = re.sub(r'\s+', '', buf)
                if 'trustthisfolder' in flat and 'trust' not in answered:
                    # курсор «No, exit»-те тұрады → төмен көрсеткі, сосын Enter
                    answered.add('trust'); time.sleep(0.4)
                    if '❯No' in flat:
                        os.write(fd, b'\x1b[B'); time.sleep(0.3)
                    os.write(fd, b'\r')
                # алғашқы іске қосу экрандары (тема таңдау т.б.) — әдепкімен өту
                for key, marker in (('theme', 'Syntaxtheme'), ('style', 'Choosethetextstyle'), ('ack', 'Pressentertocontinue')):
                    if marker.lower() in flat.lower() and key not in answered:
                        answered.add(key); time.sleep(0.4); os.write(fd, b'\r')
                m = URL.search(buf) or URL.search(flat)
                if m and not url:
                    url = m.group(0); print('URL ' + url, flush=True); done_at = time.time()
                for line in text.splitlines():
                    line = line.strip()
                    if re.search(r'(?i)error|not on github|failed', line):
                        print('LOG ' + line[:200], flush=True)
            if done_at and time.time() - done_at > 3:
                break
    finally:
        try:
            os.kill(pid, signal.SIGTERM); time.sleep(0.5); os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    if not url:
        tail = re.sub(r'\s+', ' ', buf)[-400:]
        print('LOG URL табылмады: ' + tail, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
