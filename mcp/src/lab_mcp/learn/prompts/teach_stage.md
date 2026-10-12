Teach me the stage `{stage}` of the Plant Parent cloud lab at a **{level}** level.

Ground everything in this repository, using the lab-learn tools; do not rely on memory.

1. Call `explain_stage` with depth "full" for `{stage}`, then read its README and notes with `read_file` (the paths are in the result).
2. Teach in this order, one short section each: what it is and why it exists; the architecture (what talks to what); the files that matter and what each teaches; how to run and verify it; the gotchas and lessons from its notes (use `lessons_for`); how it differs from the stage it builds on (use `compare_stages`).
3. Cite `path:line` for every claim.
4. Because this is a local learning lab, say clearly what is simplified compared with production (read `blueprint://simplifications`).
5. End with three questions that check understanding, and wait for my answers.
