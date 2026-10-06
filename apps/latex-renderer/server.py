"""Private, isolated TeX worker. No database credentials or host mounts belong here."""
import io
import stat
import zipfile
import json
import os
import re
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_SOURCE = 500_000
MAX_ARCHIVE = 25 * 1024 * 1024
MAX_EXPANDED = 50 * 1024 * 1024
MAX_PDF = 25 * 1024 * 1024
SLOT = threading.Lock()


def engine_for(source):
    directive = re.search(r'^\s*%\s*!TeX\s+(?:program|TS-program)\s*=\s*(\S+)', source, re.I | re.M)
    if directive:
        engine = directive.group(1).lower()
        if engine not in ('pdflatex', 'xelatex'):
            raise ValueError('Compiler yang didukung: pdflatex dan xelatex. Ubah directive !TeX program jika sesuai dokumen.')
        return engine
    return 'xelatex' if re.search(r'\\usepackage(?:\[[^\]]*\])?\{[^}]*(?:fontspec|polyglossia)', source) else 'pdflatex'


def extract_project(data, work):
    allowed = {'.tex', '.latex', '.sty', '.cls', '.clo', '.fd', '.def', '.bib', '.bst', '.png', '.jpg', '.jpeg', '.pdf', '.otf', '.ttf', '.txt', '.csv', '.dat'}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > 400:
                raise ValueError('ZIP kosong atau terlalu banyak entri (maksimum 400).')
            seen, files, total = set(), 0, 0
            for entry in entries:
                name = entry.filename.replace(chr(92), '/')
                parts = name.rstrip('/').split('/')
                mode = stat.S_IFMT(entry.external_attr >> 16)
                if ('\x00' in entry.orig_filename or any(ord(char) < 32 for char in name) or len(name) > 240 or len(parts) > 15 or any(not part or part in ('.', '..') or ':' in part or '\x00' in part for part in parts)
                        or mode not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1):
                    raise ValueError('ZIP memuat lokasi berkas, tautan, atau enkripsi yang tidak didukung.')
                key = '/'.join(parts).casefold()
                if key in seen:
                    raise ValueError('ZIP memuat nama berkas yang duplikat.')
                seen.add(key)
                if entry.is_dir():
                    continue
                files += 1
                total += entry.file_size
                if files > 200 or entry.file_size > MAX_ARCHIVE or total > MAX_EXPANDED:
                    raise ValueError('ZIP melampaui batas 200 berkas atau 50 MB setelah diekstrak.')
                if Path(name).suffix.lower() not in allowed or key == 'main.pdf':
                    raise ValueError('Jenis berkas ZIP tidak didukung atau memakai nama hasil kompilasi main.pdf.')
            main = next((entry for entry in entries if entry.filename == 'main.tex' and not entry.is_dir()), None)
            if main is None:
                raise ValueError('ZIP harus memiliki main.tex di folder teratas, bersama folder gambar dan berkas pendamping.')
            if main.file_size > MAX_SOURCE:
                raise ValueError('Ukuran main.tex maksimum 500 KB.')
            written = 0
            for entry in entries:
                if entry.is_dir():
                    continue
                target = work.joinpath(*entry.filename.replace(chr(92), '/').split('/'))
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open('xb') as output:
                    size = 0
                    while chunk := source.read(65536):
                        size += len(chunk)
                        written += len(chunk)
                        if size > MAX_ARCHIVE or written > MAX_EXPANDED:
                            raise ValueError('Isi ZIP melewati batas ukuran ekstraksi.')
                        output.write(chunk)
            return (work / 'main.tex').read_text(encoding='utf-8-sig')
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, OSError) as error:
        raise ValueError('ZIP rusak, format kompresi tidak didukung, atau susunan folder bertabrakan.') from error


def compile_document(data, project=False):
    with tempfile.TemporaryDirectory(prefix='lesson-') as directory:
        work = Path(directory)
        source = extract_project(data, work) if project else data.decode('utf-8-sig')
        if not project:
            (work / 'main.tex').write_text(source, encoding='utf-8')
        engine = engine_for(source)
        env = {'LANG': 'C.UTF-8', 'PATH': os.environ['PATH'], 'HOME': directory, 'TMPDIR': directory,
               'openin_any': 'p', 'openout_any': 'p', 'shell_escape': 'f',
               'TEXMFOUTPUT': directory, 'TEXMFVAR': directory, 'TEXMFCONFIG': directory}
        command = ['prlimit', '--cpu=20', f'--fsize={MAX_PDF}', '--as=805306368', '--', engine, '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', 'main.tex']
        # Repeat until references and table of contents stabilize, with a strict upper bound.
        previous = None
        for _ in range(3):
            with (work / 'compiler-output.txt').open('wb') as output:
                result = subprocess.run(command, cwd=directory, env=env, stdin=subprocess.DEVNULL,
                                        stdout=output, stderr=subprocess.STDOUT, timeout=20)
            if result.returncode:
                with (work / 'compiler-output.txt').open('rb') as log:
                    log.seek(0, 2)
                    log.seek(max(0, log.tell() - 3000))
                    detail = log.read().decode('utf-8', errors='replace')
                raise ValueError('Kompilasi TeX gagal. Periksa sintaks, paket, font, atau berkas pendamping.\n' + detail)
            state = b''.join(path.read_bytes() for path in sorted(work.glob('*')) if path.suffix in ('.aux', '.toc', '.out'))
            if state == previous:
                break
            previous = state
        pdf = work / 'main.pdf'
        if not pdf.exists() or not 0 < pdf.stat().st_size <= MAX_PDF:
            raise ValueError('Hasil PDF tidak tersedia atau melebihi 25 MB.')
        result = pdf.read_bytes()
        if not result.startswith(b'%PDF-'):
            raise ValueError('Hasil compiler bukan PDF.')
        return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never record source content or authentication headers.

    def reply(self, status, data, kind='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, b'{}')

    def do_POST(self):
        if self.path != '/compile':
            self.reply(404, b'{}')
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        project = self.headers.get('Content-Type', '').split(';')[0].strip() == 'application/zip'
        if not 0 < length <= (MAX_ARCHIVE if project else MAX_SOURCE):
            self.reply(413, b'{"error":"Ukuran TeX maksimum 500 KB atau ZIP maksimum 25 MB."}')
            return
        if not SLOT.acquire(blocking=False):
            self.reply(429, b'{"error":"Compiler sedang digunakan. Coba lagi sebentar."}')
            return
        try:
            self.connection.settimeout(10)
            source = self.rfile.read(length)
            if len(source) != length:
                raise ValueError('Unggahan sumber belum lengkap.')
            self.reply(200, compile_document(source, project=project), 'application/pdf')
        except (ValueError, UnicodeError) as error:
            self.reply(422, json.dumps({'error': str(error)}).encode())
        except subprocess.TimeoutExpired:
            self.reply(422, b'{"error":"Kompilasi melewati batas waktu. Sederhanakan dokumen."}')
        except Exception:
            self.reply(503, b'{"error":"Compiler TeX belum tersedia."}')
        finally:
            SLOT.release()


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8010), Handler).serve_forever()
