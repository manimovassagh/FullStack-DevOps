Review this proposed change to the Plant Parent cloud lab against the blueprint's rules:

{change}

1. Read `blueprint://rules` and `blueprint://simplifications`.
2. Find the closest existing stage or file with `search_blueprint`, `find_example` and `compare_stages`.
3. Check, with a citation for each point: stages stay standalone cookbooks (no shared Terraform or modules, duplication is intentional); old stages are not modified (new variants are added beside them); the stage has a pipeline with smoke tests; ports and names do not collide with other stages (see `list_stages`); the stage README and FLOCI-NOTES.md are updated; emulator-only workarounds are marked.
4. Answer as a checklist: pass / needs work / unclear, each with the citation that supports it, and the smallest fix for every "needs work".
