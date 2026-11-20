#!/usr/bin/env python3
"""Host-only, read-only cgroup v2 sampler for a Compose service.
Writes bounded JSONL logs; never reads app env, request bodies or media.
No container lifecycle operations or resource settings are changed here.
"""
import argparse
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import subprocess
import time


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=15).strip()


def number(path):
    try:
        return int(path.read_text().strip())
    except FileNotFoundError:
        return None


def counters(path):
    return {k: int(v) for k, v in (line.split() for line in path.read_text().splitlines())}


def host_memory():
    fields = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        if key in ('MemAvailable', 'SwapFree', 'SwapTotal'):
            fields[key] = int(value.split()[0]) * 1024
    return fields


def sample(container, previous):
    state = container['State']
    result = dict(container_id=container['Id'], started_at=state['StartedAt'],
                  status=state['Status'], restart_count=container['RestartCount'],
                  oom_killed=state['OOMKilled'], exit_code=state['ExitCode'],
                  health=state.get('Health', {}).get('Status'))
    if not state['Running']:
        return result
    pid = state['Pid']
    relative = next(line[3:] for line in Path('/proc/%s/cgroup' % pid).read_text().splitlines()
                    if line.startswith('0::'))
    group = Path('/sys/fs/cgroup') / relative.lstrip('/')
    current = number(group / 'memory.current')
    peak = number(group / 'memory.peak')
    cpu = counters(group / 'cpu.stat')['usage_usec']
    key = (container['Id'], state['StartedAt'])
    now = time.monotonic()
    old = previous.get(key)
    observed_peak = max(current or 0, old[2] if old else 0)
    previous[key] = (now, cpu, observed_peak)
    # CPU 100% means one fully used logical core; counters cover the whole cgroup.
    result.update(memory_current_bytes=current, memory_kernel_peak_bytes=peak,
                  memory_sampled_peak_bytes=observed_peak,
                  memory_swap_bytes=number(group / 'memory.swap.current'),
                  memory_events=counters(group / 'memory.events'),
                  cpu_usage_usec=cpu,
                  cpu_percent=round((cpu-old[1]) / ((now-old[0])*10000), 2) if old else None,
                  pids=number(group / 'pids.current'))
    io = {}
    for line in (group / 'io.stat').read_text().splitlines():
        for field in line.split()[1:]:
            name, value = field.split('=')
            io[name] = io.get(name, 0) + int(value)
    result['io'] = io
    network = {'rx_bytes': 0, 'tx_bytes': 0}
    for line in Path('/proc/%s/net/dev' % pid).read_text().splitlines()[2:]:
        name, values = line.split(':')
        if name.strip() != 'lo':
            values = values.split()
            network['rx_bytes'] += int(values[0])
            network['tx_bytes'] += int(values[8])
    result['network'] = network
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', default='reelme')
    parser.add_argument('--log-dir', default='/var/log/reelme')
    parser.add_argument('--interval', type=float, default=10)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    if args.interval <= 0:
        parser.error('interval must be positive')
    os.umask(0o077)
    Path(args.log_dir).mkdir(mode=0o700, parents=True, exist_ok=True)
    logger = logging.getLogger('reelme-observe')
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(Path(args.log_dir) / 'resources.jsonl',
                                  maxBytes=10*1024*1024, backupCount=14)
    handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(handler)
    previous = {}
    while True:
        record = {'time': datetime.now(timezone.utc).isoformat()}
        try:
            record['host_memory_bytes'] = host_memory()
            ids = docker('ps', '-aq', '--filter', 'label=com.docker.compose.project='+args.project,
                         '--filter', 'label=com.docker.compose.service=app',
                         '--filter', 'label=com.docker.compose.oneoff=False').split()
            record['containers'] = []
            active_keys = set()
            for cid in ids:
                try:
                    # Inspect only operational fields: do not retrieve Config.Env.
                    data = json.loads(docker('inspect', '--format',
                        '{"Id":{{json .Id}},"State":{{json .State}},"RestartCount":{{.RestartCount}}}', cid))
                    record['containers'].append(sample(data, previous))
                    active_keys.add((data['Id'], data['State']['StartedAt']))
                except Exception as error:
                    record['containers'].append({'container_id': cid, 'error': type(error).__name__})
            previous = {key: value for key, value in previous.items() if key in active_keys}
        except Exception as error:
            record['error'] = type(error).__name__
        logger.info(json.dumps(record, separators=(',', ':')))
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == '__main__':
    main()
