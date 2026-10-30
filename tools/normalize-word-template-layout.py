"""Keep reference-table column grids consistent with every header/body row."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"
ROOT = Path(__file__).resolve().parents[1] / "apps/web/public"


def update(filename, title):
    path = ROOT / filename
    with ZipFile(path) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
    xml = next(data for info, data in entries if info.filename == "word/document.xml")
    doc = ET.fromstring(xml)
    first = doc.find("w:body/w:p", NS)
    texts = first.findall(".//w:t", NS)
    texts[0].text = title
    for text in texts[1:]:
        text.text = ""
    for table in doc.findall(".//w:tbl", NS):
        rows = table.findall("w:tr", NS)
        headers = ["".join(cell.itertext()) for cell in rows[0].findall("w:tc", NS)]
        if len(headers) != 3 or not any("Isi Stimulus" in h or "Isi Petunjuk" in h for h in headers):
            continue
        properties = table.find("w:tblPr", NS)
        grid = table.find("w:tblGrid", NS)
        total = sum(int(col.get(W + "w")) for col in grid)
        widths = [round(total * .09), round(total * .25)]
        widths.append(total - sum(widths))
        for col in list(grid):
            grid.remove(col)
        for width in widths:
            ET.SubElement(grid, W + "gridCol", {W + "w": str(width)})
        layout = properties.find("w:tblLayout", NS)
        if layout is None:
            layout = ET.SubElement(properties, W + "tblLayout")
        layout.set(W + "type", "fixed")
        for row in rows:
            cells = row.findall("w:tc", NS)
            assert len(cells) == 3, "Reference table must have three cells per row"
            for cell, width in zip(cells, widths):
                cell_properties = cell.find("w:tcPr", NS)
                for span in cell_properties.findall("w:gridSpan", NS):
                    cell_properties.remove(span)
                cell_width = cell_properties.find("w:tcW", NS)
                if cell_width is None:
                    cell_width = ET.SubElement(cell_properties, W + "tcW")
                cell_width.set(W + "w", str(width))
                cell_width.set(W + "type", "dxa")
    updated = ET.tostring(doc, xml_declaration=True, encoding="UTF-8", standalone=True)
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        for info, data in entries:
            archive.writestr(info, updated if info.filename == "word/document.xml" else data)
    print(f"Updated {filename}")


if __name__ == "__main__":
    update("template_soal_pengetahuan.docx", "Template Soal Pengetahuan")
    update("template_soal_kepribadian.docx", "Template Soal Kepribadian")
