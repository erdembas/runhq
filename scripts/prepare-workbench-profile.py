"""Create a separate local RunHQ profile once, using consistent SQLite snapshots."""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path


def prepare(source: Path, destination: Path):
    if destination.exists():
        if not (destination / '.workbench-profile').exists():
            raise RuntimeError('Refusing to reuse a profile without a Workbench marker.')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.profile-', dir=destination.parent))
    try:
        config_path = source / 'config.json'
        if config_path.exists():
            config = json.loads(config_path.read_text())
            for service in config.get('services', []):
                service['auto_start'] = False
                service['open_browser'] = False
            for stack in config.get('stacks', []):
                stack['auto_start'] = False
            (temporary / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2))
        for database in source.glob('*.db'):
            with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as original:
                with sqlite3.connect(temporary / database.name) as snapshot:
                    original.backup(snapshot)
        agents = temporary / 'agents.db'
        if agents.exists():
            with sqlite3.connect(agents) as snapshot:
                tables = {row[0] for row in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if 'agent_workspace_records' in tables:
                    for key, raw in snapshot.execute("SELECT key,data FROM agent_workspace_records WHERE key LIKE 'schedule:%'").fetchall():
                        schedule = json.loads(raw)
                        schedule['enabled'] = False
                        snapshot.execute('UPDATE agent_workspace_records SET data=? WHERE key=?', (json.dumps(schedule), key))
                if 'agent_workflows' in tables:
                    for key, raw in snapshot.execute('SELECT id,data FROM agent_workflows').fetchall():
                        workflow = json.loads(raw)
                        workflow['auto_progress'] = False
                        # Keep pending launches so normal restart recovery labels them paused.
                        snapshot.execute('UPDATE agent_workflows SET data=? WHERE id=?', (json.dumps(workflow), key))
        if (source / 'notes').is_dir():
            shutil.copytree(source / 'notes', temporary / 'notes')
        (temporary / '.workbench-profile').write_text('Independent local development profile. Not synchronized with the installed app.\n')
        os.rename(temporary, destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


if __name__ == '__main__':
    prepare(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
