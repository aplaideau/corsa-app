"""Écrit server/changelog.tsv : sha, date, sujet, puis les lignes « Changelog: » du message (séparées par \x1f).

Les lignes « Changelog: » sont cherchées dans tout le message du commit (pas seulement dans les trailers git).
"""
import subprocess

out = subprocess.check_output(["git", "log", "-50", "--format=%H%x1f%cs%x1f%s%x1f%B%x1e"], text=True)
with open("server/changelog.tsv", "w", encoding="utf-8") as f:
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, date, subject, body = rec.split("\x1f", 3)
        items = [l.split(":", 1)[1].strip() for l in body.splitlines() if l.startswith("Changelog:")]
        f.write("\t".join([sha, date, subject.replace("\t", " "), "\x1f".join(i for i in items if i)]) + "\n")
