from pathlib import Path
import logging

logging.getLogger("weasyprint").setLevel(logging.ERROR)
from weasyprint import HTML
from pypdf import PdfWriter

root = Path(__file__).resolve().parents[1]
writer = PdfWriter()
for page in sorted((root / "output/review-pages").glob("*.html")):
    target = page.with_suffix(".pdf")
    HTML(filename=str(page)).write_pdf(str(target))
    writer.append(str(target))
    print(page.name, flush=True)
writer.write(str(root / "jarvis-mockup-v2-review.pdf"))
