import io
import stat
import zipfile
import tempfile
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import server


class CompilerTests(unittest.TestCase):
    def test_engine_selection_and_no_arbitrary_executable(self):
        self.assertEqual(server.engine_for(r'\documentclass{article}'), 'pdflatex')
        self.assertEqual(server.engine_for(r'\usepackage{fontspec}'), 'xelatex')
        self.assertEqual(server.engine_for('% !TeX program = XeLaTeX\n'), 'xelatex')
        with self.assertRaises(ValueError):
            server.engine_for('% !TeX program = bash\n')

    def test_compile_preserves_source_uses_bounded_passes_and_cleans_workdir(self):
        calls = []
        source = b'\\documentclass{article}\\begin{document}test\\end{document}'

        def run(command, **options):
            work = Path(options['cwd'])
            calls.append(work)
            self.assertEqual((work / 'main.tex').read_bytes(), source)
            self.assertIn('-no-shell-escape', command)
            self.assertEqual(options['timeout'], 20)
            self.assertEqual(options['env']['openin_any'], 'p')
            self.assertNotIn('DATABASE_URL', options['env'])
            self.assertEqual(command[0], 'prlimit')
            self.assertIn('--cpu=20', command)
            (work / 'main.pdf').write_bytes(b'%PDF-fixture')
            (work / 'main.aux').write_bytes(b'stable')
            return SimpleNamespace(returncode=0)

        with patch.object(server.subprocess, 'run', side_effect=run):
            self.assertEqual(server.compile_document(source), b'%PDF-fixture')
        self.assertEqual(len(calls), 2)
        self.assertFalse(calls[0].exists())

    def test_failure_and_timeout_do_not_return_partial_pdf(self):
        def fail(command, **options):
            (Path(options['cwd']) / 'main.pdf').write_bytes(b'%PDF-partial')
            options['stdout'].write(b'missing package example.sty')
            return SimpleNamespace(returncode=1)
        with patch.object(server.subprocess, 'run', side_effect=fail):
            with self.assertRaisesRegex(ValueError, 'example.sty'):
                server.compile_document(b'test')
        with patch.object(server.subprocess, 'run', side_effect=subprocess.TimeoutExpired('pdflatex', 20)):
            with self.assertRaises(subprocess.TimeoutExpired):
                server.compile_document(b'test')

    def test_non_pdf_compiler_output_rejected(self):
        def run(command, **options):
            (Path(options['cwd']) / 'main.pdf').write_bytes(b'not PDF')
            return SimpleNamespace(returncode=0)
        with patch.object(server.subprocess, 'run', side_effect=run):
            with self.assertRaisesRegex(ValueError, 'bukan PDF'):
                server.compile_document(b'test')


class ProjectTests(unittest.TestCase):
    def archive(self, entries):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, content in entries:
                archive.writestr(name, content)
        return output.getvalue()

    def test_main_and_image_paths_preserved(self):
        content = self.archive([('main.tex', r'\includegraphics{images/chart.png}'), ('images/chart.png', b'picture'), ('sections/intro.tex', b'intro')])
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            source = server.extract_project(content, work)
            self.assertIn('images/chart.png', source)
            self.assertEqual((work / 'images/chart.png').read_bytes(), b'picture')
            self.assertEqual((work / 'sections/intro.tex').read_bytes(), b'intro')

    def test_missing_main_and_bad_zip_rejected(self):
        for data in [b'not a zip', self.archive([('folder/main.tex', b'test')]), self.archive([('MAIN.tex', b'test')])]:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    server.extract_project(data, Path(directory))

    def test_unsafe_paths_and_reserved_output_rejected(self):
        for name in ['../outside.tex', '/absolute.tex', 'C:/absolute.tex', 'images/../../outside.tex', 'images\\..\\..\\outside.tex', 'main.pdf', 'script.exe', 'main.tex']:
            data = self.archive([('main.tex', b'test'), (name, b'bad')])
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError, msg=name):
                    server.extract_project(data, Path(directory))
                self.assertFalse((Path(directory) / 'main.tex').exists())

    def test_symlink_and_expanded_size_rejected(self):
        link = zipfile.ZipInfo('image.png')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        data = self.archive([('main.tex', b'test'), (link, b'/etc/passwd')])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                server.extract_project(data, Path(directory))
            with patch.object(server, 'MAX_EXPANDED', 10):
                with self.assertRaises(ValueError):
                    server.extract_project(self.archive([('main.tex', b'x' * 11)]), Path(directory))

    def test_project_compiles_from_root_with_companion_file(self):
        data = self.archive([('main.tex', b'test'), ('images/chart.png', b'picture')])
        def run(command, **options):
            work = Path(options['cwd'])
            self.assertEqual((work / 'images/chart.png').read_bytes(), b'picture')
            (work / 'main.pdf').write_bytes(b'%PDF-project')
            return SimpleNamespace(returncode=0)
        with patch.object(server.subprocess, 'run', side_effect=run):
            self.assertEqual(server.compile_document(data, project=True), b'%PDF-project')


if __name__ == '__main__':
    unittest.main()
