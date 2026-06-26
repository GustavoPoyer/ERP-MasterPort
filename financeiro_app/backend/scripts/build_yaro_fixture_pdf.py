"""Gera PDF de fixture com layout Atlantic para testes da extração Yaro."""

from __future__ import annotations

from pathlib import Path


def _pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf_from_lines(lines: list[str], output_path: Path) -> Path:
    y_start = 780
    line_height = 13
    stream_parts = ["BT", "/F1 8 Tf", f"40 {y_start} Td"]
    for index, line in enumerate(lines):
        if index > 0:
            stream_parts.append(f"0 -{line_height} Td")
        stream_parts.append(f"({_pdf_escape(line)}) Tj")
    stream_parts.append("ET")
    stream = "\n".join(stream_parts).encode("latin-1", errors="replace")
    stream_len = len(stream)

    objects: list[bytes] = []
    objects.append(b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n")
    objects.append(b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n")
    objects.append(
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 842]/Parent 2 0 R/"
        b"Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n"
    )
    objects.append(b"4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n")
    objects.append(
        f"5 0 obj<</Length {stream_len}>>stream\n".encode("ascii") + stream + b"\nendstream\nendobj\n"
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as handle:
        handle.write(b"%PDF-1.4\n")
        offsets = [0]
        for obj in objects:
            offsets.append(handle.tell())
            handle.write(obj)
        xref_pos = handle.tell()
        handle.write(f"xref\n0 {len(offsets)}\n".encode("ascii"))
        handle.write(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            handle.write(f"{offset:010d} 00000 n \n".encode("ascii"))
        handle.write(
            f"trailer<</Size {len(offsets)}/Root 1 0 R>>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
        )
    return output_path


def main() -> None:
    fixture_txt = Path(__file__).resolve().parent / "fixtures" / "yaro_atlantic_invoice_lines.txt"
    output_pdf = fixture_txt.with_suffix(".pdf")
    lines = [line.rstrip() for line in fixture_txt.read_text(encoding="utf-8").splitlines() if line.strip()]
    build_pdf_from_lines(lines, output_pdf)
    print(output_pdf)


if __name__ == "__main__":
    main()
