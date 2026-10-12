from pathlib import Path
import sys

import pymupdf


if len(sys.argv) != 3:
    raise SystemExit("Usage: render-pdf-pages.py input.pdf output-directory")

input_path = Path(sys.argv[1]).resolve()
output_directory = Path(sys.argv[2]).resolve()
output_directory.mkdir(parents=True, exist_ok=True)

document = pymupdf.open(input_path)
matrix = pymupdf.Matrix(2, 2)
for page_number, page in enumerate(document, start=1):
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    pixmap.save(output_directory / f"page-{page_number}.png")

print(f"Rendered {document.page_count} pages to {output_directory}")
